# Baletta Deploy Action

一个 GitHub Actions Custom Action，用于配合 [Baletta](https://github.com/ConstasJ/baletta) API 触发 Docker Compose Stack 的部署。

## 功能特性

- 🔐 API Key 认证
- 🚀 触发部署任务
- ⏳ 等待部署完成（通过 SSE 事件流）
- 📡 实时日志流 (SSE)
- ⚙️ 可配置超时
- 🔁 任务失败后的可配置重试

## 工作原理

Action 通过 Baletta 的 SSE 事件流端点 `/tasks/:taskId/events` 等待部署完成：

1. 触发部署后，建立 SSE 连接到 Baletta
2. 接收实时日志（`log` 事件）
3. 等待完成事件（`done` 或 `error`）
4. 根据事件确定最终状态

这种方式比轮询更高效，且能实时获取日志。

## 快速开始

### 前置要求

1. 运行中的 Baletta 服务
2. 在 Baletta 中配置好的项目
3. 有效的 API Key

### 生成 API Key

在 Baletta 服务器上执行：

```bash
baletta key add github-action --projects my-project
```

保存生成的 API Key，用于 GitHub Actions Secret。

### 配置 GitHub Secrets

在你的仓库中设置以下 Secrets：

- `BALETTA_API_URL`: Baletta API 地址，例如 `http://your-server:3000`
- `BALETTA_API_KEY`: 上面生成的 API Key

### 基础用法

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Baletta
        uses: your-org/baletta-action@v1
        with:
          api-url: ${{ secrets.BALETTA_API_URL }}
          api-key: ${{ secrets.BALETTA_API_KEY }}
          project: my-project
```

## 输入参数

| 参数 | 必填 | 默认值 | 描述 |
|------|------|--------|------|
| `api-url` | ✅ | - | Baletta API URL |
| `api-key` | ✅ | - | Baletta API Key |
| `project` | ✅ | - | 项目名称 |
| `wait-for-completion` | ❌ | `true` | 是否等待部署完成 |
| `timeout` | ❌ | `300` | 超时时间（秒） |
| `show-logs` | ❌ | `true` | 是否显示实时日志 |
| `retry-attempts` | ❌ | `0` | 任务失败后重新触发部署的次数 |
| `retry-delay-seconds` | ❌ | `5` | 每次重试之间的等待时间 |

## 输出参数

| 输出 | 描述 |
|------|------|
| `task-id` | 部署任务 ID |
| `status` | 最终状态 (`success`, `failed`, `running`) |
| `exit-code` | 部署退出码 |
| `started-at` | 开始时间 (ISO 8601) |
| `finished-at` | 结束时间 (ISO 8601) |

## 输出参数

| 输出 | 描述 |
|------|------|
| `task-id` | 部署任务 ID |
| `status` | 最终状态 (`success`, `failed`, `running`) |
| `exit-code` | 部署退出码 |
| `started-at` | 开始时间 (ISO 8601) |
| `finished-at` | 结束时间 (ISO 8601) |

## 高级用法

### 仅触发部署，不等待

```yaml
- name: Trigger deployment
  uses: your-org/baletta-action@v1
  with:
    api-url: ${{ secrets.BALETTA_API_URL }}
    api-key: ${{ secrets.BALETTA_API_KEY }}
    project: my-project
    wait-for-completion: false
```

### 自定义超时

```yaml
- name: Deploy with custom timeout
  uses: your-org/baletta-action@v1
  with:
    api-url: ${{ secrets.BALETTA_API_URL }}
    api-key: ${{ secrets.BALETTA_API_KEY }}
    project: my-project
    timeout: 600
```

### 任务失败时重试

```yaml
- name: Deploy with retry
  uses: your-org/baletta-action@v1
  with:
    api-url: ${{ secrets.BALETTA_API_URL }}
    api-key: ${{ secrets.BALETTA_API_KEY }}
    project: my-project
    retry-attempts: 2
    retry-delay-seconds: 10
```

### 使用输出参数

```yaml
- name: Deploy
  id: deploy
  uses: your-org/baletta-action@v1
  with:
    api-url: ${{ secrets.BALETTA_API_URL }}
    api-key: ${{ secrets.BALETTA_API_KEY }}
    project: my-project

- name: Print results
  run: |
    echo "Task ID: ${{ steps.deploy.outputs.task-id }}"
    echo "Status: ${{ steps.deploy.outputs.status }}"
    echo "Exit Code: ${{ steps.deploy.outputs.exit-code }}"
    echo "Started At: ${{ steps.deploy.outputs.started-at }}"
    echo "Finished At: ${{ steps.deploy.outputs.finished-at }}"
```

### 完整 CI/CD 工作流示例

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

  deploy:
    needs: build-and-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        uses: your-org/baletta-action@v1
        with:
          api-url: ${{ secrets.BALETTA_API_URL }}
          api-key: ${{ secrets.BALETTA_API_KEY }}
          project: production
          timeout: 600
          show-logs: true
```

## 开发

### 本地构建

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 构建
cd .. && npm run build

# 打包（使用 ncc）
npm run build
```

### 发布 Action

1. 确保 `dist/` 目录已构建并提交
2. 创建 Git tag：
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. 更新 major version tag：
   ```bash
   git tag -fa v1 -m "Update v1 tag"
   git push origin v1 --force
   ```

## 许可证

MIT
