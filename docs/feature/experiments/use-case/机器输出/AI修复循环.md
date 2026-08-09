# `--json`：让 coding agent 跑、查、改、复验

coding agent 不需要解读 TTY 重绘。
它需要稳定的 Invocation identity、完整 Attempt locator、按需读取证据的入口，以及最终 receipt。

`exp --json` 输出 Record 定义的 `InvocationMachineRecord`：Live NDJSON 后恰好一条 `InvocationReceipt`。
完整词表见 [CLI · 机器怎么读](../../cli.md#机器怎么读--json)。

## 全流程

1. 先检查计划，确认选择没有扩大：

   ```sh
   niceeval exp compare memory/commit0 --dry --json
   ```

2. 执行并读取 Live record 与末尾 receipt：

   ```sh
   niceeval exp compare memory/commit0 --json
   ```

   流中的 `snapshot`、`observation` 与 `claim` 均是完整 `LiveRecord`。
   最后一条 `receipt` 是完整 `InvocationReceipt`；不要根据局部字段自行定义缩减 JSON。

3. 只用完整 locator 展开必要证据：

   ```sh
   niceeval show @01J8ZK3M6P4T7V9X2C5N8QW0RY
   niceeval show @01J8ZK3M6P4T7V9X2C5N8QW0RY --execution
   ```

4. 修改后重新运行受影响选择。
   指纹变化时默认计划会执行受影响成员；仅外部条件变化时选择 `--rerun` 或 `--rerun all`。

5. 以退出状态和 `InvocationReceipt` 判断完成。
   一条 Live counter、Human 文案或单个 passed Claim 都不能替代完整 receipt。

## 边界

- 运行流不是第二套结果 schema。事实在 receipt 指向的 RecordGraphRef 中，由 `show`、Sample 或 Report 读取。
- `snapshot` record 只是 Reducer 的传输状态，不能当作 durable Record 事实。
- failure 的完整 Assertion、stream、diff 与 Usage 按需由 `show` 的 Projector 读取，不把整段执行内容塞回 NDJSON。

## 相关阅读

- [Record CLI · 机器输出](../../../record/cli.md#机器输出) —— `LiveRecord` 与 receipt 的穷尽形状。
- [`--json`（CI 门禁）](CI门禁.md) —— 退出码与 JUnit 的消费方式。
