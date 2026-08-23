**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

# Decision

## 定案

采纳 [PLAN-2](PLAN-2/README.md)：CLI machine query、Human show 与本地 Insight 各自拥有呈现，只共享 Analysis 的选择、比较与闭合语义。

- `niceeval query discover | run | explain` 是独立、版本化、machine-only 协议。
- `niceeval show` 是第一方人类 recipe，保留 Run → Attempt locator → exact detail 快捷链；删除 `show --json`。
- `view` 改为 `niceeval insight`。Insight 只监听 loopback，固定由 NiceEval 维护，不接受用户 Page、组件、route、theme 或静态 export。
- 多 named set、typed basis、exact selection audit 与 `side-by-side | exact | paired` 先由 Analysis 定义，再由 CLI 与 Insight 消费。
- 外部 benchmark 网页使用数据还是组件，留给[独立决策](../benchmark-web-consumption/README.md)，本裁决不预设答案。

## 依据

### CLI 不再受网页作者模型限制

Agent 可以从 compact discovery 逐步取得 descriptor schema、selection handles 与合法 selector，再经 stdin 直接执行请求。Subcommand 唯一决定 operation，request 不重复 op；错误同时提供完整 correction request 与 argv token array。

这条协议能表达任意已注册 Analysis descriptor 和多个历史 set，而不要求用户先把问题写成 Report Page。

### 自由比较仍由 Analysis 守口径

Side-by-side 分别交付各 set 分母，不形成派生比较。Exact 必须证明相同 Population 与 exact member set。Paired 只能使用具名 Relation，并原子交付左右 frame、pair frame、三份 denominator、unmatched 与 excluded。

CLI、Show formatter 和 Insight 都不能临时计算 delta、rank、trend、聚合或 pairing。需要这些结果时，先定义显式 Analysis Measure 或新的穷尽 request 类型。

### Show 保留人的最短路径

删除 `show --json` 不等于删除 `show`。Run 摘要继续显示层级、判定、历史 locator 和可复制的 exact detail / Insight 命令。Show recipe 调用与 machine query 相同的 Analysis operation，但只呈现少量稳定的人类任务。

任意 machine request 没有唯一的人类信息层级，因此不提供 `query --human`。这避免再造一个泛化 Report formatter。

### Insight 可以为 debug 优化

Insight 使用 server-global active revision、按需 DomainView、更新提示和 last-good refresh。它不用维护公共 Page / component ABI，因而可以围绕 trace、diff、source、artifact 与失败恢复持续优化。

Loopback 不等于可信。一次性 fragment credential、进程期 session、Host / Origin 验证与 no-store 响应共同形成第一方本地浏览器边界，但不构成公开 HTTP API。

## 否决项

[PLAN-1](PLAN-1/README.md) 让 CLI 能问什么取决于作者写了哪些 Page，让 machine schema 随 renderer 演进，并把本地 debug、用户站点和静态发布绑进同一生命周期。它不能兑现 AI-native discovery 与自由 comparison。

## 迁移门

本决策进入 Feature 与实现前必须一次完成以下职责迁移，不能长期维持双轨：

1. Analysis Feature 增加 `AnalysisSelectionCatalogSnapshot`、selection basis、exact selection audit、multi-set operation、comparability 与原子失败。
2. Record Host 只提供 frozen Run / Core / Slot / Attempt 公开事实与 exact handle 查找；runtime generation 保持私有，`record list` 保持独立恢复命令。
3. CLI 增加 `query discover | run | explain`，删除 `show --json`，并让 `show` 只走第一方 Analysis recipes。
4. `view`、`view --out`、ReportDefinition、Page、ResolvedPage、ClosedSiteRevision、双面组件、theme、head 与作者 asset / script 退出。
5. Insight 接管第一方 browser overview / detail、router、en / zh-CN chrome、无障碍、revision、watcher 与私有授权。
6. PricingProfile、cost Measure、MetricValue、missing、Evidence identity 与 closed codec 留在或迁入 Analysis，不进入 Insight UI owner。
7. 所有旧 Feature、Getting Started、CLI architecture、E2E owner 与公开文档同步到新入口后，才能删除旧实现。

外部网页的 data / components 接入不属于这道迁移门。该决策未定案前，不能把 Insight transport 或 machine query 当成公共网页 API。

## 遗留风险

- Selection catalog 可能很大；v1 依靠 compact index 与内容寻址分页，仍需真实项目验证 context 成本。
- Multi-set operation 会增加同一 Scope 内的 Sample 数量；实现必须用有界并发并证明中断回收。
- Insight 的浏览器授权与 revision 需要真实浏览器 E2E，不能只靠 HTTP unit test 证明。
