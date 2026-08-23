**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Goals

## 目的与范围

本决策定稿 CLI 与本地 Insight 的输入、输出、比较语义、生命周期和职责边界。它不裁决用户自写网页应当 import 数据还是组件，也不定义公开浏览器 transport。

## 设计原则

- **G1 — CLI 独立。** CLI 的能力、请求与结果不从网页组件、Page、DOM 或 renderer 推导。
- **G2 — AI-native。** Agent 能先取得紧凑 bootstrap，再按需发现 schema、descriptor 与合法历史 handle，并通过 stdin 完成查询。
- **G3 — 自由不改口径。** 用户可组合多个具名选择，但 selection、Population、分母、missing 与 Evidence 都由 Analysis 关闭。
- **G4 — 比较必须显式。** alignment 只有 `side-by-side | exact | paired`；CLI 不隐式求交、猜配对或临时计算 delta、rank、trend。
- **G5 — 人机分面。** `query` 只输出机器文档；`show` 只服务少量稳定的人类诊断任务。
- **G6 — 快捷诊断不断链。** Run 摘要必须交付失败 Attempt 的 exact locator 与可复制下一步。
- **G7 — Insight 固定。** Insight 是 NiceEval 自己维护的本地 debug UI，不是用户网页作者平台。
- **G8 — Revision 原子。** Insight 的所有标签页共享一个 active revision；更新失败保留 last-good，旧响应不能进入新 revision。
- **G9 — 本地仍需授权。** Loopback transport 不向任意网页开放；所有数据请求都绑定本进程 session、Host 与 exact Origin。
- **G10 — 外部网页中立。** 本决策不引入 Bundle、React adapter、Astro integration、公共 server 或静动态同 transport 的承诺。

## 可验证要求

- Agent 不读源码即可从 bootstrap 走到一次 exact 历史查询。
- 多集合响应能逐 set 审计实际选择、basis、Population、分母与问题。
- `show --run` 到 `show @<locator>` 的路径可以只靠终端输出完成。
- Insight 启动、刷新、失败、并发标签页、授权和退出都有唯一可观察状态。
