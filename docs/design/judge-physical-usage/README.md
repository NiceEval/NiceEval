# Judge 物理调用与费用 —— Design Decision

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

决定 Judge 物理请求、费用证据和完整性应由 Attempt 独立账本拥有，还是依赖 Assertion 审计汇总。候选需要同时满足失败重试、旧 Record未知和统一公开展示。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1（已选择）](plans/plan-1/README.md)
- [plan-2](plans/plan-2/README.md)

裁决：[plan-1](plans/plan-1/README.md)。
<!-- concord.design-index/v1:end -->
