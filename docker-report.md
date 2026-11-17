# Docker 构建与运行验证结果

- 运行时间：2026-11-17 07:18:48 UTC
- 提交：f17bd836e710ee2c7c3b15e44d6e41a531ff70ea

## 镜像体积

| 镜像 | 体积 | 应用内容层 |
| --- | --- | --- |
| node:24-alpine | 59.6 MB | - |
| aiqa-before（未使用 .dockerignore） | 62.0 MB | 2.31 MB |
| aiqa（使用 .dockerignore） | 59.7 MB | 0.03 MB |

体积差：优化后比优化前减少 2.29 MB。

## 构建耗时

- 对照镜像（完整上下文，首次）：2242 ms
- 正式镜像（首次）：342 ms
- 修改 src/server.js 后重建（命中缓存）：329 ms，复用 CACHED 层 2 个
- 同等条件 --no-cache 重建：344 ms

## 容器运行

```
qa-helper Up 2 seconds 0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
```

健康检查：
```json
{"status":"ok","mode":"demo","model":"演示模式","timeoutMs":30000,"knowledgeBase":{"file":"data/course-notes.md","chunks":10}}
```

提问接口（截断）：
```json
{"question":"什么是过拟合？","answer":"这是演示模式的预设回答：当前没有配置 LLM_API_KEY，系统未真正调用大模型。\n\n关于「什么是过拟合？」，课程资料中最相关的内容如下：\n\n1. 《二、过拟合、欠拟合与正则化》\n   偏差与方差：偏差高通常对应欠拟合，方差高通常对应过拟合。\n\n2. 《一、人工智能�
```
