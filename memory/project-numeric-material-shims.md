# 项目重复实现缺失数值与分位数材料

使用方为 null 到 unavailable 的转换和 p50/p90 的线性插值维护重复 helper；裸 null 若被数值转换会错误地变成零。
目标是 measured(value, { unavailable }) 与 quantile(samples, p, { method })，统一拒绝无样本、非有限值并保留样本数量及算法元数据。
验收通过安装后评估的 Assertion 与评分结果，覆盖 null、空集合、非有限值、端点、线性插值和 nearest-rank；不对无样本输出零分。
正式契约见 docs/feature/assertions/library/README.md。
