# Before cache 被声明出处拆成重复准备层

## 现象

相同 base、Provider preparation identity 和有序 action 内容由不同 Experiment 声明时，准备缓存无法共享。GitHub #287 报告重复 prepared artifact。

## 根因

运行时 action manifest 将 owner、ordinal、频率与依赖声明纳入 key 和 replacement scope。debug 的 linked prefix 还混入 consumer cohort，导致相同内容显示不同前缀。Docker manifest 命中校验另行比较 changeFrequency，单独移除 key 中的频率仍不能实现共享。

## 修复

按 [Sandbox 层级契约](../docs/feature/sandbox/library/layers.md) 保留捕获状态事实，按 schedule 顺序计算内容身份；出处独立放入当前 consumer 的 attribution manifest，debug 仍呈现当前 owner、顺序、频率和依赖。运行时 key、manifest 与 replacement 协议升为 v3，linked-plan 协议升为 v2，旧 key 只能 miss。Docker 保留频率存储字段，但不再以它拒绝同内容命中。

## 验证与边界

公开 CLI 的既有 sandbox-action-debug owner 在旧安装候选上取得正式红灯 nered_CQ21V1ZWBV1QY18B：仅改变 Experiment 声明名，16 个 linked prefix 身份全部改变。当前候选的同一 CLI owner 通过，保留新声明出处且全部 prefix 身份一致。

生命周期既有 setup-prefix-cache owner 的定向安装后 Docker 用例通过：改变 Experiment 名、频率和不影响执行顺序的依赖声明后全部缓存命中；内容变化继续重建相应后缀，各 Attempt 仍使用独立 writable clone。旧候选上的生命周期红灯尝试被并行升级的 Query v3 请求阻断，没有把该失败当作本问题的 red 证据。

修复候选 SHA-256 为 8e85904403174196e962bb57378f78a58eb2ff69e980f16902b859225191dae4。pnpm typecheck、pnpm lint、command-plan 定向 Unit 均通过。未访问真实 Incus 或 /data 缓存。

## 集成验收

集成候选 SHA-256 为 `51ec09ed246c8478cad4eecb8b5a9f7cfefde02043dab722c9c6b3a2b9988bc9`。当前测试 owner 的正式 red、green 与完整 takeover 已由受管命令验证并绑定；takeover 包含独立副本、同目录重复、项目默认并行、清理后重跑及资源清理。

- `e2e/cli/test/sandbox-action-debug.test.ts#neref_76fd3f9c854d3e09048232d0c2774443`：inventory `neinv_W9T6CED8A8DMTRN2`，red `nered_ZMQVRRCSZA5ZCKE8`，takeover `netake_DFCX972VEJQR2TZH`。
- `e2e/lifecycle/test/sandbox-setup-prefix-cache.test.ts#neref_cbd99bb3962507b80447dd599f430166`：inventory `neinv_CKQ3BET33BX9TETS`，red `nered_RJ9B0P45A1J4NSZE`，takeover `netake_07ESYPMJ57BKS6Y2`。

上述刷新 red 使用明确重建的回归候选，不能解释为原历史版本：在最终候选的源码上只恢复相关旧行为，并保留新版公开诊断解码器，以便当前安装后测试能够收集。原历史 red 仍保留在上文。通用重建候选 SHA-256 为 `e4d0756d79c75b4322746909fb345d3785c08b2bb56c3a3ca6289273a01855a6`，源码基点为 `9e02c7304416c93863c88a4dff69d20450e74370`；测试由正式 runner 安装 tarball 后通过公开入口执行，不把 collection 错误计为产品红灯。重建后逐文件核对恢复摘要并重建发布运行时。

本轮 `pnpm typecheck`、`pnpm test`（146 项）和 `pnpm lint` 通过。未运行真实 Incus/OpenSandbox 服务验收，未清理真实 `/data` 缓存；协议故障端与隔离 Docker 运行结果不代表这些服务的生产验收。
