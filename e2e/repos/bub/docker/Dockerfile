# bub 需要 curl(uv 安装脚本)与 git(bub 本体与 OTel 插件都是 git+https 依赖,
# uv 解析 git 依赖时会 shell 出真实的 git 二进制,不自带)。ca-certificates 是两者的
# TLS 前提。uv 自己下载、管理 python 3.12 工具链,镜像不需要预装系统 python3。
# 默认 node:24-slim 三者都没有(见 scripts/build-docker-env.ts 的验证记录)。
FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
