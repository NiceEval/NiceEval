# Limits

- RecordAttachment 已固定 exact owner、family、schema、closure、完整验证与六态读取。
- owner-local converter 不能同时读取多个旧 family；跨 family 历史重写需要独立维护机制。
- `available` 会读取并解码完整 closure；局部 view 不等于 range read。
- 原始 provider frames、secret、hidden chain of thought 与任意 attributes 不能因改名为 physical 而落盘。
- Projection 的公共结果固定保留 Sample entry 与 RecordAttachment 六态。PLAN-1 直接使用这个结果；PLAN-2 候选需要
  额外 Receipt / representation state，因此若改选它就必须重开 Projection 契约。Observability 决策不能拥有
  Assertions、Verdict 或 Sources 的读取 API。
