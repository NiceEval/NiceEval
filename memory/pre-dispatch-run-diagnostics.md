# 派发前共享失败的 Run 诊断

GitHub #279。Sandbox setup-prefix 失败进入 failuresByPair 并阻止 Attempt reservation，但没有写入实验诊断累积器；Run-owned niceeval.runner-diagnostics 因而丢失该失败，公开 run.get 也未投影 Run diagnostics。Human 错误文本没有说明省略的字节数。

采用 docs/feature/experiments/cli/README.md 与 docs/feature/inspection/architecture.md 已定契约：共享失败在 ERRORS 聚合，安全正文保留头尾并注明省略字节数。Run diagnostic receipt 的可选 affectedSlotIds 保存受影响槽位，归一化保留该字段，run.get 映射为 affectedPlannedAttemptIds；show --run 读取同一查询结果。共享 before、setup-prefix、build 失败按 Run 和失败身份去重，不创建 Attempt 或从正文反推槽位。JSON profile 为这些失败输出 diagnostic；其它 warning 语义保持原样。

安装后旧候选的正式 CLI 红灯 nered_E9FY2XY670MERPY6 命中省略字节标记缺失。该轮后续受到 not-started 汇总断言阻断，未执行 Run diagnostics 查询断言，不把它计作诊断查询的独立红灯证据。CLI fixture 必须在 prefix 实验显式配置 sandboxCache.before 为 use，覆盖测试项目的 bypass；否则错误发生于真实 Attempt 创建后，无法覆盖派发前路径。

修复候选 sha256:6f9e7e7eb0d47136161ecbdc6ad293e0a95c375788f0a143915bc942de5a3ca6 的 provider-error-feedback CLI 切片已通过：before、build、setup-prefix 持久诊断，关联槽位、show 人读内容、JSON diagnostic 事件和资源回收均通过。

## 集成验收

集成候选 SHA-256 为 `51ec09ed246c8478cad4eecb8b5a9f7cfefde02043dab722c9c6b3a2b9988bc9`。当前测试 owner 的正式 red、green 与完整 takeover 已由受管命令验证并绑定；takeover 包含独立副本、同目录重复、项目默认并行、清理后重跑及资源清理。

- `e2e/cli/test/provider-error-feedback.test.ts#neref_4021142eb40cc28cb6d7b07cf4854390`：inventory `neinv_W9T6CED8A8DMTRN2`，red `nered_7R3R6D7AFGQWFCDX`，takeover `netake_9WYCPD7648R5F256`。
- `e2e/insight/test/view-run-diagnostics.browser.spec.ts#neref_5c9f8d2dc0b94f0e538555f50e8fa44e`：inventory `neinv_TWCTCY8NB81ZJV37`，red `nered_YY5B3P01428ECZ9K`，takeover `netake_7772PXVWFDAZ7RS3`。

上述刷新 red 使用明确重建的回归候选，不能解释为原历史版本：在最终候选的源码上只恢复相关旧行为，并保留新版公开诊断解码器，以便当前安装后测试能够收集。原历史 red 仍保留在上文。通用重建候选 SHA-256 为 `e4d0756d79c75b4322746909fb345d3785c08b2bb56c3a3ca6289273a01855a6`，源码基点为 `9e02c7304416c93863c88a4dff69d20450e74370`；测试由正式 runner 安装 tarball 后通过公开入口执行，不把 collection 错误计为产品红灯。重建后逐文件核对恢复摘要并重建发布运行时。

Insight 同时包含 Vitest 与 Playwright。浏览器 takeover 必须追加 `-- --config playwright.config.ts`，让不带文件 selector 的默认并行轮进入 Playwright；只传 reporter 参数会误入 Vitest 并因报告缺少 suites 被拒绝。该次失败不算浏览器证书；其 4 项 Vitest 运行单独通过，最终浏览器证据覆盖完整 Playwright suite。

本轮 `pnpm typecheck`、`pnpm test`（146 项）和 `pnpm lint` 通过。未运行真实 Incus/OpenSandbox 服务验收，未清理真实 `/data` 缓存；协议故障端与隔离 Docker 运行结果不代表这些服务的生产验收。
