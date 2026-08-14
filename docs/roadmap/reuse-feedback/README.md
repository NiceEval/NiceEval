# 结果携带与 Sandbox 复用反馈

## 要解决的 Frog / DX 摩擦

操作者在预览、运行日志和事后报告里需要回答同一个问题：某个 Slot 为什么携带历史 Attempt，或为什么需要执行。
如果 CLI、scheduler 和 writer 各自重新读取 Record 并组织理由，三处会给出相互矛盾的答案。

另一个常见误读是把结果携带和 Sandbox 复用都叫作 `reused`。
前者采用历史 Attempt，后者让本次真实执行的 Attempt 共用一台 Sandbox。
两者必须有不同名字和不同 owner。

## 核心心智

`project-target/v1` 在一个 frozen Record view 上产生唯一的 `ExecutionReusePlan`。
计划中每个目标 Slot 只带一项穷尽 action：

- `carried` 表示采用一个历史 Attempt。
- `execute` 表示把这个 Slot 交给 planner/scheduler。

action、历史 Attempt locator 与解释是同一个 frozen plan slot 的字段。
任何 Human 输出、JSON 事件、scheduler 输入和 membership provenance 都只投影该字段，不能再次比较资格或重建理由。
执行沿用说明（Reuse explanation）就是这个 frozen plan slot 给出的同源理由与 prior locator。

`carried` 只描述结果携带。
`sandbox.reused` 只描述本次 Attempt 是否在共用 Sandbox 中真实执行。

## 范围

本方向包含：

- 以 `carried` 统一结果携带的 Human、JSON 与持久 provenance 名字；
- 让 frozen plan 同时拥有 action、完整历史 locator 与解释；
- 让 `--dry`、运行反馈与 sealed Run 审计同一项计划决定；
- 为声明 `sandboxReuse` 的 Experiment 与 Eval Group 提供运行级汇总。

本方向不改变 reuse eligibility、source barrier、显式 `accept`、Sandbox 生命周期或重跑 policy。
它不保存第二份 reuse 事实，也不提供 `--reuse-verify`。
同一 Eval 连跑两次不能证明没有残留污染；需要该类保证时，作者编写专门 Eval。

## owner 与公开验收

`project-target/v1` planner 拥有计划决定。
Record 拥有已封口的 Attempt、Member 与 membership provenance。
CLI 只显示冻结决定；Report 只读取已发布 Run。

本方向不新增 Eval Assertion。
公开行为由真实 `niceeval exp`、`niceeval exp --dry`、`niceeval show` 与 `niceeval view` 旅程验收。
CLI-only 行为使用真实 CLI/E2E 入口，不以内部 Assertion 代替。

## 入口

- [Library](library.md) —— frozen plan、action、locator 与 provenance 形状。
- [CLI](cli.md) —— `exp`、`--dry`、JSON、退出码与审计输出。
- [Architecture](architecture.md) —— 唯一决定链、并发、seal、失败与删除边界。
