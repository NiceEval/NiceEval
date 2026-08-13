# Live 工具正调不要锁死模型可自由格式化的 query

## 现象

PR #47 的 Claude Code WebSearch A/B 使用同一条 prompt：工具可用的 Experiment 必须调用，
`permissions.deny` Experiment 正常完成且零调用。正调真实调用成功，工具状态为 completed，
但 Claude 把搜索词编码为 `{"query":"\"niceeval e2e mcp test\""}`；Eval 用
`jsonMatch({ query: "niceeval e2e mcp test" })` 锁死无引号表示，因而把成功调用判成失败。

## 裁决

这条 Journey 的契约是工具面，不是搜索引擎 query 的字符串规范：

- 正例断言目标工具名、completed 状态与调用次数；
- deny 反例断言同一工具零调用；
- 两边都要求 Turn succeeded；
- 只有功能契约明确规定参数表示时，才精确匹配 query。自然语言里的引号、空白、大小写或
  等价搜索语法不应成为 availability owner 的第二个隐含契约。

相同 prompt 的正反控制仍然必要：正例防止模型无论工具是否存在都直接回答固定文本，反例
证明 deny 从可用工具面移除了能力。
