# 现象

Incus doctor 只验证未登记对象，缺失的 committed instance / volume 会被误报为库存正常。数量配额不能证明 pool 仍有复制空间，公开 CLI 缺少 inventory 与两阶段 GC，失效 intent 持续占用配额。

## 根因与契约

doctor 没有逐对比对 committed intent；capture / consumer copy 没有 pool 字节准入；repository 未持久化成功 lease 时间和 GC 审计。实现依据为 docs/feature/sandbox-nested-docker/cli.md、lifecycle.md 与 architecture.md，设计提交 4f59fcb18。

父验收还发现中断 retirement 的接管缺口：preview 排除全部已有 retirementPlanId 的 intent，claim 也拒绝更换 plan，导致旧 plan 过期或记录失败 outcome 后无法释放容量。新 preview 应重新核对 lease 与现存双对象 metadata，沿用已登记的回收依据；claim 将 retirement owner 纳入证据摘要并原子替换，保留逐对象 absence receipt。旧 preview 无法夺回删除权，旧 outcome 只返回原结果。

## 验证

e2e/lifecycle/test/incus-artifact-maintenance.test.ts 通过安装后 CLI 和隔离 Incus 协议故障端验证 inventory、doctor、预览、实际删除、漂移拒删、lease 变化跳过、absence receipt，以及删除失败后的完整双对象和部分 absence 接管。恢复缺口的正式红灯为 nered_WQPQJ3VNT5Q4RF6X：失败后 fresh preview 错误返回零候选。

e2e/lifecycle/test/incus-artifact-storage.test.ts 的正式红灯为 nered_ZD44EYB8ZNCVRGJB：旧 doctor 在 pool 空间不足时仍成功。两项证据绑定 memory/incus-artifact-maintenance.md 的 epoch 0 和 inventory neinv_67B6A1VWR15YCR42。

修复候选通过上述两项 owner 与 incus-user-database-ledger.test.ts，共 3 项 targeted E2E，cleanup 通过；pnpm typecheck、concord docs check 与 pnpm lint 通过。

## 集成验收

集成候选 SHA-256 为 `51ec09ed246c8478cad4eecb8b5a9f7cfefde02043dab722c9c6b3a2b9988bc9`。当前测试 owner 的正式 red、green 与完整 takeover 已由受管命令验证并绑定；takeover 包含独立副本、同目录重复、项目默认并行、清理后重跑及资源清理。

- `e2e/lifecycle/test/incus-artifact-maintenance.test.ts#neref_d2effa6c75c25c8316250b520c2f515f`：inventory `neinv_CKQ3BET33BX9TETS`，red `nered_0W3XYAX9PVHJQD9E`，takeover `netake_P6TWVNNAPFG8XBXD`。
- `e2e/lifecycle/test/incus-artifact-storage.test.ts#neref_dd86a3872e3fdd76c91f13afbea86468`：inventory `neinv_CKQ3BET33BX9TETS`，red `nered_7CN2Z12PZSMXKQZZ`，takeover `netake_WHFHJEZTPM6WKWPR`。

上述刷新 red 使用明确重建的回归候选，不能解释为原历史版本：在最终候选的源码上只恢复相关旧行为，并保留新版公开诊断解码器，以便当前安装后测试能够收集。原历史 red 仍保留在上文。通用重建候选 SHA-256 为 `e4d0756d79c75b4322746909fb345d3785c08b2bb56c3a3ca6289273a01855a6`，源码基点为 `9e02c7304416c93863c88a4dff69d20450e74370`；测试由正式 runner 安装 tarball 后通过公开入口执行，不把 collection 错误计为产品红灯。重建后逐文件核对恢复摘要并重建发布运行时。

维护用例另外使用只恢复“排除已有 retirementPlanId”旧分支的候选（SHA-256 `27e5734ccdfdfa3dca938840670a21fbce41cdb1c2c1469fae304b884fe30123`），保留当前 doctor 输出与公开解码器，确认红灯直接命中中断回收后 fresh preview 无候选；该证据用于最终维护关系。容量用例沿用通用重建候选。

本轮 `pnpm typecheck`、`pnpm test`（146 项）和 `pnpm lint` 通过。未运行真实 Incus/OpenSandbox 服务验收，未清理真实 `/data` 缓存；协议故障端与隔离 Docker 运行结果不代表这些服务的生产验收。
