---
name: e2b-sandbox
description: e2b base 模板只有 node20 + ~481MB 内存(npm install 会 OOM kill),内存/node 版本由模板烘焙决定不能创建时调;重 eval 用预制模板 fasteval-agents,构建踩坑清单在正文
metadata:
  type: infra-bug
---

# e2b sandbox:base 模板跑不动重 eval,用预制 fasteval-agents 模板

e2b 后端在 `src/sandbox/e2b.ts`(SDK 包 `e2b`),鉴权用 `E2B_API_KEY`(team 级),工厂 `e2bSandbox({ template })`。

## 现象

- e2b 默认 `base` 模板自带 **node v20.9.0**,不是 node24。`SandboxRuntime`(node20/node24)字段对 e2b **不生效**——e2b 的 node 版本由模板烘焙决定,创建时不能选(docker/vercel 才按 runtime 选)。
- **`base` 模板只有 ~481MB 内存 + 2 vCPU**(实测)。跑 memory evals 的 `npm install`(Next.js 依赖)会被 **OOM kill**,表现为 `CommandExitError: signal: killed`。e2b 内存在**模板构建时**定(`e2b.toml` 的 `memory_mb`),创建时不能调——默认 base 跑不动重 eval。

## 修法

用预制模板 `e2bSandbox({ template: "fasteval-agents" })`(`src/sandbox/templates/e2b.toml` 设 `memory_mb = 4096`,烘焙 node24 + agent CLI),需先构建模板(见 `src/sandbox/templates/`)。

预制模板把 codex/claude-code/bub 烘焙到 `/usr/local/bin`(对所有沙箱用户在 PATH 上),三个 agent adapter 的 `setup()` 用 `command -v` 探测到就跳过安装。改 bub 安装规格要同步三处:`agents/bub.ts`、`templates/Dockerfile`、`templates/build-vercel-snapshot.mts`。

## 预制模板(fasteval-agents)构建踩坑(都已修,记于 templates/Dockerfile + README)

- CLI 用 `e2b template create <name> --memory-mb 4096 --cpu-count 2 -c "..." --ready-cmd "..."`(`e2b template build` 已废弃;`-c` 与 `--ready-cmd` 必须同时给)。
- e2b 的 Dockerfile 解析会**吃掉反斜杠和双引号**:`printf '%s\n'` 变 `%sn`、`"${VAR}"` 变字面——别用 shell 写文件,改 `COPY` 一个 checked-in 文件(bub-override.txt)。
- e2b 层间**不保留 `/tmp`**:COPY 目标放 `/opt` 等持久路径(放 /tmp 下一层 RUN 找不到)。
- bub 必须 `uv tool install --overrides`(钉 fork):OTEL 插件依赖上游 bubbuild/bub,直装会 URL 冲突。
- **非 root 跑 bub 的权限**:uv 把 venv 建在 root 名下,venv 的 python 符号链接指向 `/root/.local/share/uv/python/...`,而 `/root` 是 700 → 非 root 报 `bad interpreter: Permission denied`。修法:`UV_PYTHON_INSTALL_DIR=/opt/uv-python` + `chmod -R a+rX /opt/uv-tools /opt/uv-python`(只 chmod uv-tools 不够,python 在另一个目录)。
- **e2b 并发敏感**:同时起 2 个 e2b sandbox 各跑 npm install,曾让其中一个报 `SandboxError: terminated`;串行(maxConcurrency: 1)全程通过。别同时跑多个 e2b 实验。

相关:[[vercel-sandbox-issues]]、[[sandbox-home-hardcode]]、[[sandbox-field-no-bare-string]]
