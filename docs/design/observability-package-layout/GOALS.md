# Goals

- package 边界忠实表达 owner、事实权威、seal transaction、completeness 与 retention。
- 单个 package 的失败不污染可独立成立的 facts。
- Projection 不因物理布局不同而获得两套读取 API。
- schema 与 migration 的 blast radius 有明确上界。
- OTel、Agent events、timing 与 diagnostics 的多源输入不能静默合并。durable schema 要么保留 producer identity，
  要么由唯一事实权威完成 canonicalization，并用 collection limitation 保留被舍弃的输入。

本决策不改变 Record Core，不设计跨 package relation，也不设计 Report 查询语言。
