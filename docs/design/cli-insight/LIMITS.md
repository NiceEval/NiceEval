**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Limits

- **L1 — Record reader 是 Host capability。** CLI、Insight 前端与普通作者代码都不能从 path 构造 reader。
- **L2 — 当前 Analysis query 是单 Sample。** 多 named set 的冻结、对齐和原子失败必须先成为 Analysis 责任，不能只存在于 CLI codec。
- **L3 — Logical Slot 与 Attempt 不同。** 同一 Attempt 可以被多个 Slot 引用；exact Attempt locator 不能猜成 origin Slot 或全部 reference Slots。
- **L4 — Record runtime generation 是私有能力身份。** 跨进程 discovery 只能使用公开内容身份，不能保存 Scope token 或 nominal handle。
- **L5 — Record inventory 有独立目标。** `niceeval record list` 服务 receipt 丢失后的完整恢复，不分页、不筛选，也不成为 query 的隐藏 inventory。
- **L6 — Analysis 输出不只平表。** 比较使用 `SemanticFrame`；trace、diff、source、artifact 与执行详情仍使用具名 `DomainView`。
- **L7 — Machine stdout 必须单一。** 成功或领域失败恰好写一个版本化 JSON document；进度与进程级崩溃只写 stderr。
- **L8 — Insight 是长寿本地进程。** 它同时拥有 server、watcher、Sample、browser session 与 in-flight RPC，必须明确统一回收。
- **L9 — Loopback 不是信任边界。** 浏览器中的恶意页面仍可向本机端口发请求，因此私有 RPC 需要 session 与 Origin 验证。
- **L10 — NiceEval 处于 beta。** 可以删除旧 Report / view 公共面，但要保留 Analysis 正确性与人类诊断链。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：CLI、terminal 与 browser 继续共享双面 Report 作者树。
- [PLAN-2](PLAN-2/README.md)：机器 query、人类 show 与固定 Insight 各自拥有呈现，共享 Analysis 语义。
