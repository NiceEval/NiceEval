**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Goals

## 目的与范围

本决策定稿 machine query、第一方 runtime View、RecordSnapshot 的输入、输出、比较语义与资源边界。它不裁决用户网页、静态报告站或公开浏览器 transport。

## 设计原则

- **G1 — AI-native query。** Agent 能先取得紧凑 bootstrap，再通过 stdin 或文件完成版本化请求。
- **G2 — 人类 View。** 人通过固定浏览器界面查看 overview 与 exact detail，不需要 terminal formatter 充当第二个人类产品面。
- **G3 — 一处语义。** selector、sealed cutoff、分母、partial、missing、issues、Evidence 与 comparison 只由 Inspection operation 关闭。
- **G4 — source 与 selection 正交。** selection 回答看哪些 sealed facts；source 回答从 project operational Store 还是 portable snapshot 读取。
- **G5 — portable 不等于 runtime capability。** Snapshot 是受验证的 sealed-only artifact；reader、Scope、watcher、session 与 credential 永不移出 Host。
- **G6 — View 可刷新，Snapshot 不会动。** operational Store 的 View 可提示并刷新到新 cutoff；Snapshot View 不 watch、不 refresh。
- **G7 — 呈现层私有。** query codec、View 的步骤、formatter、view model、route、component、renderer、theme 与 presentation schema 各自拥有。
- **G8 — 明确交付边界。** 不提供静态页面、Netlify、匿名 URL、离线分享或导出目录；分享需要 Snapshot 与兼容 NiceEval runtime。

## 可验证要求

- Agent 不读源码即可从 `query discover` 走到一次 exact 历史查询。
- 同一 operation 经 query 与 View 显示时，不会产生第二套 selector、comparison、missing 或 Evidence 计算。
- 未给 `--record` 的 View 在 sealed publication 后可刷新；给出 Snapshot 的 View 不产生 watcher 或 refresh。
- `view --json` 只发出脱敏的 `niceeval.view-lifecycle/v1` NDJSON `ready`、`closed` 或 `failed` 事件，不持久化 receipt。
