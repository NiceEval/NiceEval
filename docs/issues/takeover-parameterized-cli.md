# CLI takeover 默认负载阶段无法完成参数化用例收集

在 NiceEval checkout `9ee4d1e96bea9e9e7a484e47d48a235e1c663c5c` 上，对已通过正式定点验收的 CLI owner 执行：

`pnpm e2e takeover --candidate <tgz> --repo cli --selector e2e/cli/test/provider-error-feedback.test.ts#neref_4b8eff8d867ebecc67415db1fd2ec1ee`

三份独立副本和同一副本两次均通过，默认 Repo 阶段未生成收据，最终为 infra、矩阵不完整。候选 SHA-256 为 `eba494add99bcdb17f2394f07e05ac807eab51f65b82bdaf2a44c98b7173d414`，Linux、Node 24.21、pnpm 11.18、Vitest 5.1。公开证据为 `/tmp/niceeval-ci-takeover2-cli/takeover-summary.json`；当时错误包装丢失 detail，此诊断保留已在本轮修正。

预期：受支持的并发参数化测试能参加默认负载验收，或在运行前给出具名的收集限制。CLI 的 `cloud-lifetime.test.ts` 使用 `test.concurrent.each`，而当前 inventory 静态绑定仅识别直接 test/it 声明；需要后续核实并维护参数化 case identity。不得跳过这些用例或放松完整矩阵检查来制造证书。

已查 open/closed Issue，未找到相同项。来源为本轮 CI 修复的正式验收；仅包含公开源码、受控测试与本地收据位置，无 secrets。未发布远端 Issue。
