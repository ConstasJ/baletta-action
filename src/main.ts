import * as core from "@actions/core";
import { EventSource } from "eventsource";

interface DeployResponse {
  status: string;
  taskId: string;
}

export async function run(): Promise<void> {
  try {
    // Get inputs
    const apiUrl = core.getInput("api-url", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const project = core.getInput("project", { required: true });
    const waitForCompletion = core.getBooleanInput("wait-for-completion");
    const timeout = parseInt(core.getInput("timeout"), 10);
    const showLogs = core.getBooleanInput("show-logs");
    const retryAttempts = Math.max(
      0,
      parseInt(core.getInput("retry-attempts"), 10) || 0
    );
    const retryDelaySeconds = Math.max(
      0,
      parseInt(core.getInput("retry-delay-seconds"), 10) || 0
    );

    core.info(`🚀 Triggering deployment for project: ${project}`);
    core.info(`📡 API URL: ${apiUrl}`);

    let attempt = 0;
    let result: TaskCompletionResult | undefined;

    while (attempt <= retryAttempts) {
      if (attempt > 0) {
        core.warning(
          `🔁 Deployment failed. Retrying attempt ${attempt + 1} of ${retryAttempts + 1}...`
        );

        if (retryDelaySeconds > 0) {
          core.info(
            `⏳ Waiting ${retryDelaySeconds} seconds before retrying...`
          );
          await sleep(retryDelaySeconds * 1000);
        }
      }

      // Trigger deployment
      const deployResponse = await triggerDeploy(apiUrl, apiKey, project);

      if (deployResponse.status !== "ok") {
        throw new Error(`Deployment failed: ${JSON.stringify(deployResponse)}`);
      }

      const taskId = deployResponse.taskId;
      core.info(`✅ Deployment triggered successfully!`);
      core.info(`📋 Task ID: ${taskId}`);

      // Set outputs
      core.setOutput("task-id", taskId);

      if (!waitForCompletion) {
        core.info("⏭️  Not waiting for completion (wait-for-completion: false)");
        core.setOutput("status", "triggered");
        return;
      }

      // Wait for completion via SSE event stream
      core.info("⏳ Waiting for deployment to complete...");
      result = await waitForTaskCompletion(
        apiUrl,
        apiKey,
        taskId,
        timeout,
        showLogs
      );

      if (result.status === "success") {
        break;
      }

      if (attempt >= retryAttempts) {
        break;
      }

      attempt += 1;
    }

    if (result === undefined) {
      throw new Error("Deployment did not return a completion result");
    }

    // Set final outputs
    core.setOutput("status", result.status);
    core.setOutput("exit-code", result.exitCode?.toString() ?? "");
    core.setOutput("started-at", result.startedAt);
    core.setOutput("finished-at", result.finishedAt ?? "");

    // Final status
    if (result.status === "success") {
      core.info(`✅ Deployment completed successfully!`);
      core.info(`⏱️  Started: ${result.startedAt}`);
      if (result.finishedAt) {
        core.info(`⏱️  Finished: ${result.finishedAt}`);
      }
    } else if (result.status === "failed") {
      core.error(`❌ Deployment failed with exit code: ${result.exitCode}`);
      if (retryAttempts > 0) {
        core.error(`🔁 Retried ${attempt} time(s) before giving up`);
      }
      throw new Error(`Deployment failed with exit code: ${result.exitCode}`);
    } else {
      core.warning(`⚠️  Deployment ended with unknown status: ${result.status}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

async function triggerDeploy(
  apiUrl: string,
  apiKey: string,
  project: string
): Promise<DeployResponse> {
  const url = `${apiUrl}/deploy/${encodeURIComponent(project)}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as Promise<DeployResponse>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface TaskCompletionResult {
  status: "success" | "failed" | "unknown";
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
}

async function waitForTaskCompletion(
  apiUrl: string,
  apiKey: string,
  taskId: string,
  timeoutSeconds: number,
  showLogs: boolean
): Promise<TaskCompletionResult> {
  return new Promise((resolve, reject) => {
    const url = `${apiUrl}/tasks/${taskId}/events`;
    const startedAt = new Date().toISOString();
    let finishedAt: string | undefined;
    let exitCode: number | undefined;
    
    const eventSource = new EventSource(url, {
      fetch: (requestUrl, init) => {
        const headers = new Headers(init.headers);
        headers.set("X-API-Key", apiKey);

        return fetch(requestUrl, {
          ...init,
          headers,
        });
      },
    });

    // Setup timeout
    const timeoutId = timeoutSeconds > 0 
      ? setTimeout(() => {
          eventSource.close();
          reject(new Error(`Deployment timed out after ${timeoutSeconds} seconds`));
        }, timeoutSeconds * 1000)
      : null;

    eventSource.onopen = () => {
      core.info("📡 Connected to event stream");
    };

    // Handle log events
    eventSource.addEventListener("log", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (showLogs) {
          core.info(`[${data.timestamp}] ${data.line}`);
        }
      } catch {
        if (showLogs) {
          core.info(event.data);
        }
      }
    });

    // Handle deployment completion (success)
    eventSource.addEventListener("done", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        finishedAt = data.finishedAt;
      } catch {
        finishedAt = new Date().toISOString();
      }
      
      if (timeoutId) clearTimeout(timeoutId);
      eventSource.close();
      
      resolve({
        status: "success",
        exitCode: 0,
        startedAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
      });
    });

    // Handle deployment error (failure)
    eventSource.addEventListener("error", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        exitCode = data.exitCode;
        finishedAt = data.finishedAt;
        core.error(`❌ Deployment failed: ${data.message}`);
      } catch {
        core.error(event.data);
        finishedAt = new Date().toISOString();
      }
      
      if (timeoutId) clearTimeout(timeoutId);
      eventSource.close();
      
      resolve({
        status: "failed",
        exitCode: exitCode ?? 1,
        startedAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
      });
    });

    // Handle connection errors
    eventSource.onerror = (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      eventSource.close();
      reject(new Error(`SSE connection error: ${error}`));
    };
  });
}
