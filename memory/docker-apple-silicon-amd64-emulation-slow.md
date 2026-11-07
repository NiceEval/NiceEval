# 本机(Apple Silicon)docker 默认拉 amd64 镜像,沙箱型 eval 在模拟层下变慢好几倍

**现象**：`dockerSandbox()` 用默认镜像(`node:24-slim` / `node:20-slim`)在 macOS(M 系列芯片)
上跑,`docker run` 打印
`WARNING: The requested image's platform (linux/amd64) does not match the detected host
platform (linux/arm64/v8) and no specific platform was requested`。同一段 `apt-get update &&
apt-get install -y ca-certificates git curl` + `npm install -g @anthropic-ai/claude-code` 组合,
在这台机器上实测跑到 80s+;`docker image inspect node:24-slim --format
'{{.Architecture}}/{{.Os}}'` 确认拉到的是 `amd64/linux`,而 `uname -m` 是 `arm64`——容器整段在
QEMU 模拟层下跑,不是原生速度。

**根因**：`DOCKER_IMAGES` 里的默认镜像名(`node:24-slim` 等)没有指定 `platform`,Docker Desktop
在 arm64 宿主上默认仍按 amd64 拉取(可能是 daemon 配置或镜像 manifest 选择逻辑),不会自动选
arm64 变体,即使 `node:*-slim` 官方镜像其实是多架构的。这不是 niceeval 的 bug,是本机 Docker
环境的默认行为;Linux amd64 的 CI runner 上跑同样的镜像会是原生速度,不会复现这个问题。

**修法**(环境认知,非代码修复):
- 本地在 Apple Silicon 上验证沙箱型 eval,`timeoutMs` 要比"预估的真实模型调用时间"多留
  数倍余量(e2e claude-code / codex 项目定的 600_000ms,大半是给这层模拟开销)。
- 若长期需要在 Apple Silicon 本机高频跑沙箱 eval,可以考虑给 `dockerSandbox({ source: { type: "image", image } })`
  传一个显式声明 `--platform linux/arm64` 拉取的自定义镜像/预制模板,避免每次都在模拟层跑;
  这次没有做(超出本任务范围),只是记录下来供以后决定要不要做。
- 排查沙箱型 eval "本地慢、CI 应该会快"或反过来的性能差异时,先用
  `docker image inspect <image> --format '{{.Architecture}}'` 对比 `uname -m`,确认是不是在
  踩这层模拟,不要直接归因到模型或框架。

适用场景:任何在 Apple Silicon 本机验证/开发 dockerSandbox 型 eval 的场景。
