# Case 目录中的嵌套仓库被当作宿主评估用例发现

GitHub #280。契约见 docs/feature/eval/README.md：含 eval.ts 的 case 目录拥有子目录资产，发现器停止扫描其子目录；普通 .eval.ts 旁的子目录仍参与发现。

## 复现与根因

在 case/eval.ts 旁放入 repo/nested.eval.ts、repo/nested.eval.tsx、repo/eval.ts 与 repo/eval-group.ts。安装后旧候选经 exp --dry --json 校验或导入这些资产，报重复 ID 或执行资产顶层代码。walkFiles 对所有子目录递归，Eval Group 扫描也没有 case 边界。

## 修正与验证

Eval 与 Eval Group 扫描共享目录入口判定，在文件夹入口处停止递归。Experiment 扫描保持原规则。公开 CLI owner 为 e2e/cli/test/case-discovery.test.ts，以会抛错的嵌套资产和三个明确计划 ID 区分错误实现。

旧候选 commit 为 4f59fcb18c560404dcdf93319196d11df3a2ce0c，tarball SHA-256 为 44bed3100b526c04c87df3d1f66ae70906673b2bc72b7e115715a92e14763663。正式 red 为 nered_8B5RDE84X9HBBXCD，绑定本 Problem epoch 0；最早失败为 discovery.duplicate-id。原生库存 neinv_R5FHSEV17HTJHR1D，selector 为 e2e/cli/test/case-discovery.test.ts#neref_108929a15afaf1e96f5d728afb50ba14。

修复候选 SHA-256 为 aadb54efac8fd21301cd2951fec4e28d74a5c9e7f1f2bc65e3fec486808e30b0，公开单项 E2E 转绿并完成资源清理。pnpm typecheck、pnpm lint 与 pnpm test（146 项）通过。

## 集成验收

集成候选 SHA-256 为 `51ec09ed246c8478cad4eecb8b5a9f7cfefde02043dab722c9c6b3a2b9988bc9`。当前测试 owner 的正式 red、green 与完整 takeover 已由受管命令验证并绑定；takeover 包含独立副本、同目录重复、项目默认并行、清理后重跑及资源清理。

- `e2e/cli/test/case-discovery.test.ts#neref_108929a15afaf1e96f5d728afb50ba14`：inventory `neinv_W9T6CED8A8DMTRN2`，red `nered_47SG8S9M82J7CPJ0`，takeover `netake_01MMD3FQFAKZ4ECZ`。

上述刷新 red 使用明确重建的回归候选，不能解释为原历史版本：在最终候选的源码上只恢复相关旧行为，并保留新版公开诊断解码器，以便当前安装后测试能够收集。原历史 red 仍保留在上文。通用重建候选 SHA-256 为 `e4d0756d79c75b4322746909fb345d3785c08b2bb56c3a3ca6289273a01855a6`，源码基点为 `9e02c7304416c93863c88a4dff69d20450e74370`；测试由正式 runner 安装 tarball 后通过公开入口执行，不把 collection 错误计为产品红灯。重建后逐文件核对恢复摘要并重建发布运行时。

本轮 `pnpm typecheck`、`pnpm test`（146 项）和 `pnpm lint` 通过。未运行真实 Incus/OpenSandbox 服务验收，未清理真实 `/data` 缓存；协议故障端与隔离 Docker 运行结果不代表这些服务的生产验收。
