# Limits

- RecordAttachment 已固定 exact owner、family、schema、closure、完整验证与六态读取。
- owner-local converter 不能同时读取多个旧 family；跨 family 历史重写需要独立维护机制。
- `available` 会 materialize 完整 closure；局部 view 不等于 range read。
- 原始 provider frames、secret、hidden chain of thought 与任意 attributes 不能因改名为 physical 而落盘。
- Projection 拥有参数化的通用读取结果。PLAN-1 把 layout state 实例化为 `never`；PLAN-2 提供自己的
  Receipt 与 representation state。Observability 决策不能拥有 Assertions、Verdict 或 Sources 的读取 API。
