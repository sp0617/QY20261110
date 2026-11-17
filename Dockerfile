# AI 答疑助手：零运行时依赖 + 无构建步骤，单阶段镜像即可
FROM node:24-alpine

WORKDIR /app

# 只复制运行必需的文件；--chown 让内置 node 用户可读，data 目录可写
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data

# 容器内必须监听 0.0.0.0，否则端口映射到宿主机后无法访问
ENV PORT=3000 \
    HOST=0.0.0.0

# 使用镜像内置的非 root 用户运行
USER node

EXPOSE 3000

CMD ["npm", "start"]
