# Attempt 错误摘要丢失长消息末尾请求标识

已安装候选的 `niceeval exp provider-error --rerun all` 在 Incus cache degraded 后发布 errored Attempt，但 Human 错误摘要丢失消息末尾的 request ID。期望安全有界摘要保留首尾，并可由 locator 下钻。公开回归入口：`pnpm e2e run --candidate <tgz> --repo cli -- --run test/provider-error-feedback.test.ts`。

证据：本地正式收据 `/tmp/niceeval-ci-cli-green/cli/receipt.json`；candidate SHA-256 为 `2e22a6ac9420abe500442c6815d6cdb85ae2bcbced1a4f20cb79dbd3bb32e7a8`，checkout HEAD `65bd81a1049d42f86d83124b892804722e743a61`。Linux、Node 24、pnpm 11，受控 Incus CLI fixture，无真实 provider 调用。安全测试标识 `req_prefix_capacity_123` 不含 secret。

已查询 open/closed Issues；#279 为已关闭的派发前诊断问题，本项发生在已发布 Attempt 反馈，属于不同公开路径。来源为 CI 修复后的定向公开入口复验；内容可公开，未作远端 mutation。
