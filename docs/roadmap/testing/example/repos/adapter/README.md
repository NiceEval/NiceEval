# 适配器场景 Repo（docs 示例）

三个独立真实场景 Repo，每个都是完整用户项目（package.json / e2e.json /
niceeval.config.ts / evals / experiments / test，按需 backend）：

| Repo | 证明什么 | lane | 需要什么 |
|---|---|---|---|
| [`ai-sdk/`](ai-sdk/README.md) | 真实适配器公开边界：`uiMessageStreamAgent` 经 HTTP 接入自带应用，不带命名空间的工具名从公开执行证据读回 | main / nightly / release | `OPENAI_API_KEY` |
| [`codex-cli/`](codex-cli/README.md) | 真实适配器公开边界：`codexAgent` 在 Docker Sandbox 跑真实命令，规范 `shell` 从公开执行证据读回 | main / nightly / release | `CODEX_API_KEY` + Docker |
| [`local-protocol/`](local-protocol/README.md) | 无密钥可控错误：本地 5xx fixture → errored 带阶段与原因，不冒充 live / E2B paginator | pr | 无 |

正式 lockfile 规则（不手写示意 lockfile、真实实现 pnpm install 生成并签入、候选
tarball 注入与指纹核对）写在各叶子 Repo 的 README。

`ai-sdk` 与 `codex-cli` 是可执行的 live contract 示例，但 docs 验收不会真的消耗 key、模型费用或搭建外部 CLI；
本地与 PR 可直接跑的代表是 `adapter/local-protocol`。新增 Claude Code、OpenCode 或其它适配器时增加同形叶子，
而不是继续加进某个共享 test 文件。
