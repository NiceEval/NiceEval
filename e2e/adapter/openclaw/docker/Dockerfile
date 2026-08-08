# OpenClaw 需要 Node >=22.22.3 或 >=24(官方 CLI 启动硬门槛)。
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
