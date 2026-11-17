# 部署说明（DEPLOY）

AI 答疑助手：Node.js 原生 HTTP 服务，零运行时依赖、无构建步骤。默认监听 `3000` 端口，未配置 `LLM_API_KEY` 时以演示模式返回预设回答。

## 1. 前置条件

| 项目 | 要求 |
|---|---|
| Node.js | ≥ 20，推荐 24（与 CI 一致） |
| npm | 随 Node 安装 |
| Docker | 可选，仅容器化部署需要 |
| 数据文件 | `data/course-notes.md` 必须存在，否则检索无内容 |

## 2. 本地启动

```bash
# 1) 安装依赖（项目零运行时依赖，这里只会安装测试用的 devDependencies）
npm install

# 2) 启动服务
npm start
# 等价于 node src/server.js

# 3) 访问
# 浏览器打开 http://localhost:3000
```

自定义监听地址与端口：

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

Windows PowerShell：

```powershell
$env:PORT=8080; $env:HOST="0.0.0.0"; npm start
```

快速验证：

```bash
curl http://localhost:3000/api/health
# {"status":"ok","mode":"demo",...,"knowledgeBase":{"file":"data/course-notes.md","chunks":10}}
```

## 3. 容器构建与运行

```bash
# 构建（单阶段，仅复制 package.json、src、public、data）
docker build -t aiqa .

# 前台运行，映射端口
docker run --rm -p 3000:3000 aiqa

# 后台运行，便于查看状态与日志
docker run -d -p 3000:3000 --name qa-helper aiqa
docker ps
docker logs -f qa-helper

# 停止并删除
docker stop qa-helper && docker rm qa-helper

# 查看镜像体积
docker images aiqa
```

持久化问答记录（`data/qa-records.jsonl` 默认写在容器内，容器删除即丢失）：

```bash
docker run -d -p 3000:3000 --name qa-helper \
  -v "$PWD/data:/app/data" aiqa
```

> 镜像内已设置 `HOST=0.0.0.0`。若自行覆盖，请勿改回 `127.0.0.1`，否则宿主机端口映射无法访问。

## 4. 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `LLM_API_KEY` | 否 | 空 | 为空时进入演示模式，返回预设回答 |
| `LLM_BASE_URL` | 否 | `https://api.openai.com/v1` | 兼容 OpenAI Chat Completions 协议的接口地址 |
| `LLM_MODEL` | 否 | `gpt-4o-mini` | 模型名称 |
| `LLM_TIMEOUT_MS` | 否 | `30000` | 调用大模型的超时（毫秒） |
| `PORT` | 否 | `3000` | 服务端口 |
| `HOST` | 否 | `127.0.0.1` | 监听地址；容器内必须为 `0.0.0.0` |

配置方式：

```bash
# 本地
export LLM_API_KEY=sk-xxxx
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4o-mini
npm start

# 容器：运行时注入，不要把密钥写进镜像或 Dockerfile
docker run -d -p 3000:3000 --name qa-helper \
  -e LLM_API_KEY=sk-xxxx \
  -e LLM_MODEL=gpt-4o-mini \
  aiqa

# 或用 env 文件（该文件已被 .dockerignore 排除）
docker run -d -p 3000:3000 --env-file .env aiqa
```

## 5. 常见故障排查

### 5.1 端口被占用（`EADDRINUSE`）

现象：启动报 `Error: listen EADDRINUSE: address already in use :::3000`。

```bash
# 查看占用进程
ss -ltnp | grep :3000
# 或
lsof -i :3000

# 结束占用进程（确认属于本项目后再执行）
kill <PID>

# 或直接换端口
PORT=3001 npm start
```

容器场景还需确认宿主机端口未被占用；`docker ps` 中若已存在映射 3000 的容器，先 `docker stop`。

### 5.2 依赖缺失 / 模块找不到

现象：`Cannot find module ...` 或 `ERR_MODULE_NOT_FOUND`。

```bash
# 重新安装依赖
npm install

# 确认 Node 版本 ≥ 20
node -v
```

运行端到端测试时如果提示浏览器不存在：

```bash
npx playwright install --with-deps chromium
```

补充：`npm start` 只依赖 Node 内置模块，不依赖 `node_modules`；`node_modules` 缺失只影响测试。

### 5.3 容器无法启动

按顺序排查：

```bash
# 1) Docker 守护进程是否运行
docker info

# 2) 镜像是否存在
docker images aiqa

# 3) 容器是否立刻退出，查看原因
docker ps -a
docker logs qa-helper

# 4) 确认端口映射与监听地址
curl http://localhost:3000/api/health
```

常见原因与处理：

| 现象 | 原因 | 处理 |
|---|---|---|
| `docker: Cannot connect to the Docker daemon` | Docker 未启动 | 启动 Docker Desktop / `dockerd` |
| `Unable to find image 'aiqa:latest' locally` | 镜像未构建或名称不符 | 先执行 `docker build -t aiqa .` |
| 容器启动后立即退出，日志无报错 | 缺少 `data/course-notes.md` 或 `src` 拷贝不完整 | 检查 `.dockerignore` 是否误排除，重建镜像 |
| 宿主机访问 `localhost:3000` 无响应 | 容器内监听 `127.0.0.1` | 设置 `HOST=0.0.0.0` 后重启容器 |
| 页面正常但问答报错 | `LLM_API_KEY` 无效或接口不可达 | 检查密钥、`LLM_BASE_URL` 与网络；可先留空走演示模式 |
| 写入记录失败（权限错误） | 挂载的 `data` 目录宿主机属主不可写 | 调整目录权限，或去掉 `-v` 使用容器内目录 |

### 5.4 健康检查与日志

```bash
curl -s http://localhost:3000/api/health
docker logs --tail 100 qa-helper
```

`/api/health` 返回 `"status":"ok"` 且 `chunks` 大于 0，说明服务与课程资料加载正常；`chunks` 为 0 时优先检查 `data/course-notes.md`。

## 6. 部署后验收清单

- [ ] `npm start` 或 `docker run` 后能打开首页
- [ ] `/api/health` 返回 `status: ok`，`chunks` 为 10
- [ ] 提交一个问题能返回答案与引用资料
- [ ] `docker ps` 中容器状态为 `Up`，端口映射正确
- [ ] 敏感信息通过环境变量注入，未写入镜像
