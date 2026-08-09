# codex-cli 场景 Repo（docs 示例）

live 适配器 Repo：`experiments/tool-call.ts` 用真实官方工厂 `codexAgent`
（`niceeval/adapter`）在 Docker Sandbox 里跑真实 `codex exec --json`。本 Repo 证明：
真实命令调用同时保留协议原名 `command_execution` 与规范分类 `shell`、调用与结果配对成立，且从 `niceeval show --run <runId> --page <attempt-execution-route>` 的公开执行页面可见。进入 main / nightly / release lane
（见 `e2e.json.lanes`），需要真实凭据与 Docker。

## 怎么跑

```sh
# NiceEval 根目录；main/nightly/release lane 注入凭据并检查 Docker
pnpm e2e --repo adapter/codex-cli

# 已安装候选包的独立 codex-cli Repo 根目录
pnpm test            # 需要 CODEX_API_KEY / CODEX_BASE_URL 与 Docker
```

根 runner 的临时副本隔离不同 invocation；每条会写 `.niceeval` 的 case 还使用自己的项目副本，
让同一 Repo 以后增加测试文件时仍可保留 Vitest 默认并行。Docker 资源身份也必须由该 case 独占。

## lockfile 规则（正式）

- 本目录是 docs 示例，**不签入、不手写** `pnpm-lock.yaml`：文档里手写的 lockfile 必然
  过期，只制造"看起来可复现"。真实实现时 `pnpm install` 生成 lockfile 并随代码签入。
- 根 runner 在**临时副本**里把 `niceeval` 依赖替换成候选 tarball，安装后核对实际 executable
  到的包与 tarball 指纹一致；独立 checkout 不注入候选时，测的就是 lockfile 锁定的
  已发布的对照版本（本示例依赖声明 `niceeval ^0.4.6`）。
- 本目录不是 pnpm workspace 成员；真实 e2e Repo 需要自带只含 `packages: []` 的
  `pnpm-workspace.yaml`，让自己成为 workspace root、不向上并入父级。

## 内容

| 路径 | 角色 |
|---|---|
| `experiments/tool-call.ts` | `codexAgent`，凭据读 `CODEX_API_KEY` / `CODEX_BASE_URL` |
| `evals/tool-call/shell.eval.ts` | `echo` 任务 → `calledTool("shell")` + `noFailedActions` |
| `test/tool-identity.test.ts` | 私有项目副本里的 `exp` / `show`：原始 `command_execution`、规范 `shell` 与命令入参读回 |

Codex CLI 事件解码路径（`src/o11y/parsers/codex.ts`）自始带规范名。
identity 丢失的故障家族写在 `memory/sdk-stream-transformers-missing-canonical-tool.md`
（SDK 流转换器路径）。本 Repo 用同一份读回固定 CLI 入口的规范名。
