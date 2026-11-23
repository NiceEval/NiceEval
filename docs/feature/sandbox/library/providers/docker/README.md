# Docker

`dockerSandbox()` 与 `dockerComposeSandbox()` 在本机 Docker 上创建 Sandbox，不需要云凭据。factory 的公共形状见 [Library · 起点参数](../../README.md#起点参数与-lifetimems)，Before cache 能力见 [Before cache · Provider 能力](../../../architecture/before-cache.md#provider-能力)，内部实现见 [Docker Provider 架构](../../../architecture/providers/docker.md)。

## 预制实例

官方起点就是默认镜像 `node:24-slim`(省略 `image` 时按 runtime 选它)。写 Dockerfile 从它派生、把 Agent CLI 烘焙进去。`npm install -g` 装进 `/usr/local/bin`,正好落在沙箱注入的 PATH 上;沙箱默认以非 root 的 `node`(UID 1000)用户跑命令,装到别处(如 `~/.local/bin`)的 Agent 需自己进 PATH:

```dockerfile
# Dockerfile
FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.144.1
```

```typescript
// docker build -t acme-codex-evals:0.144.1-r1 . 之后
sandbox: dockerSandbox({ source: { type: "image", image: "acme-codex-evals:0.144.1-r1" } })
```

镜像只在构建机上时是单机可用;要在 CI 或多机消费,push 到项目自己的 registry,`image` 字段写完整引用。

## 现场接入与回收

原生 CLI 的分工见 [CLI · 原生 CLI 现场接入与资源管理](../../../cli.md#原生-cli-现场接入与资源管理)。Docker 现场使用以下命令：

- 开发者交互调试：`docker exec -it <sandboxId> /bin/bash`（直接利用原生的 PTY、信号穿透与快捷键支持）；
- Coding Agent 非交互排查：`docker exec <sandboxId> <command>`（单次执行、拿到结构化 stdout/stderr，不阻塞挂起）；
- 查看全部存活/留存沙箱：`docker ps -a --filter "label=niceeval"`；
- 销毁特定沙箱：`docker rm -f <sandboxId>`；
- 批量销毁所有留存/残留容器：`docker rm -f $(docker ps -aq --filter "label=niceeval")`；
- 强杀或异常中断后的孤儿回收：`docker container prune -f` 或 `docker system prune`。

NiceEval 登记的构建镜像与 Before cache 镜像用 [`niceeval docker cache inventory`](../../../cli.md#docker-image-cache-inventory) 只读查看。
