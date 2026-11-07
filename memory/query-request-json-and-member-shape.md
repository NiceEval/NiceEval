# Query lacks argv requests and a shared planned member result

## Problem

Issues #289 and #290: callers without stdin cannot send a full Query request in argv. Run and Experiment members expose the same Attempt metrics at different paths, and Run duplicates the Attempt locator.

## Contract

Follow [Inspection CLI](../docs/feature/inspection/cli.md): exactly one of `--request` and `--request-json`, strict `niceeval.query/v3`, and shared PlannedAttemptMember result fields beside a binding-only publication.

## Cause

Query only reads a request file/stdin. Overview embeds metrics inside publication while run.get builds a separate member result.

## Implementation and verification

The CLI shares JSON decoding and the request-size limit across both transports. Run and Overview now use one metric projection and the same member schema; show and View read the sibling metrics and the publication locator. The shared verdict projection preserves the existing fallback for failed Assertions reads.

The installed pre-change candidate reproduced both missing argv support and the inconsistent metric path. Targeted installed-candidate checks cover Query, show, the public package entry and downstream member consumers.

## 集成验收

集成候选 SHA-256 为 `51ec09ed246c8478cad4eecb8b5a9f7cfefde02043dab722c9c6b3a2b9988bc9`。当前测试 owner 的正式 red、green 与完整 takeover 已由受管命令验证并绑定；takeover 包含独立副本、同目录重复、项目默认并行、清理后重跑及资源清理。

- `e2e/inspection/test/query-request-json.test.ts#neref_4649188958a49e6da5393136358b2d4d`：inventory `neinv_ZT7B74NZCPM776XQ`，red `nered_BTY88FPPXSBFD2K2`，takeover `netake_8KZBTK3FAP7KEA2Y`。
- `e2e/inspection/test/inspection-query.test.ts#neref_bed902a18f5f371e36ec24256ebb6af7`：inventory `neinv_ZT7B74NZCPM776XQ`，red `nered_4W8S6J4H6KAXRPAX`，takeover `netake_D0YAFG7QCCDAKVM9`。

上述刷新 red 使用明确重建的回归候选，不能解释为原历史版本：在最终候选的源码上只恢复相关旧行为，并保留新版公开诊断解码器，以便当前安装后测试能够收集。原历史 red 仍保留在上文。通用重建候选 SHA-256 为 `e4d0756d79c75b4322746909fb345d3785c08b2bb56c3a3ca6289273a01855a6`，源码基点为 `9e02c7304416c93863c88a4dff69d20450e74370`；测试由正式 runner 安装 tarball 后通过公开入口执行，不把 collection 错误计为产品红灯。重建后逐文件核对恢复摘要并重建发布运行时。

成员结构使用独立重建候选（SHA-256 `63116639283dfa5d598302410706d11b86c75ccbc90cdcbc1265a1f05b7ce60f`），恢复 a03364ce0 之前 Overview published member 将指标嵌入 publication 的布局及对应历史 schema；保持 v3 请求输入。它用于成员结构 owner 的直接红灯，argv owner 使用通用候选。

本轮 `pnpm typecheck`、`pnpm test`（146 项）和 `pnpm lint` 通过。未运行真实 Incus/OpenSandbox 服务验收，未清理真实 `/data` 缓存；协议故障端与隔离 Docker 运行结果不代表这些服务的生产验收。
