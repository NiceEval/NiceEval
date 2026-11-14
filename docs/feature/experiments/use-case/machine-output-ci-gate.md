# CI 门禁:退出码、JUnit 与人读日志

## 解决什么问题

把 eval 挂成 PR 门禁或夜间任务后,消费者变成两个:按退出码判红绿、按 JUnit 做注解的 CI 平台,和事后翻日志页的人。
niceeval 不需要专门的 CI 档——日志页给人看,默认的人读文本在非 TTY 下自动是只追加流(无 ANSI、失败带 locator、空闲 30 秒心跳防平台误杀);平台注解走 `--junit`;需要 JSON 汇总时在运行后读结果面,不解读运行日志。

## 全流程

1. 门禁命令钉报告路径:

   ```sh
   niceeval exp ci --junit ./niceeval-junit.xml
   ```

2. 日志是人读追加流,整流走单一 `stdout`——CI runner 分开缓冲两个 OS stream 也不会把失败行和结束摘要打乱序([流边界](../cli/README.md#输出流和落盘节奏))。
   需要机器消费运行事件(自建注解 adapter、实时看板)时加 [`--json`](../cli/README.md#机器怎么读--json) 换成 NDJSON,两种形态事实一致。
3. 门禁只认退出码:`0` 全部通过且运行完整完成计划;`1` 有 `failed` / `errored`、budget 未完成计划或 required reporter 写失败;`2` 未捕获崩溃;`130` 中断。
   折叠规则见 [Runner · 退出码](../../../runner.md#退出码)。
4. 归档文件：`--junit` 是整次运行的最终聚合，收尾时写临时文件并原子替换目标——CI 归档到的要么是完整文件，要么不存在。
   Run create 后立即可见；每个 Attempt 以独立 transaction 原子发布 closure、publication identity 与 Planned attempt binding。`SIGINT` 保留已发布 Attempt，并以 `interrupted-before-publication` 收口其余 Planned attempt。
   需要 JSON 汇总时，归档 receipt，再以 `createdRunIds` 执行 `niceeval show run:<run-id> --json`。
5. JUnit 交给平台做测试注解；完整业务数据以 cutoff 内的 Run 与 Attempt 事实为准。

同一份人读结束反馈让日志读者看到门禁为何结束。正常完成有稳定的结果表和精确下钻：

```text
╭─ PASSED ─────────────────────────────────────────────────────── 54s ─╮
│ 2 passed · 0 failed · 0 errored  (0 reused)                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ RESULTS ───────────────────────────────────── 1 run configuration ─╮
│ compare/codex                                                        │
│   memory/commit0  1/1 passed                                         │
│   memory/commit1  1/1 passed                                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ NEXT ───────────────────────────────────────────────────────────────╮
│ compare/codex                                                        │
│   show: niceeval show run:8f3d6f62-1d34-4cf3-99c7-84ba3c483706       │
│   view: niceeval view run:8f3d6f62-1d34-4cf3-99c7-84ba3c483706       │
╰──────────────────────────────────────────────────────────────────────╯
```

断言未通过或 execution error 保持非零；后者逐 Attempt 保留安全有界的真实错误和这一条 Attempt 的下钻命令，不把不同错误合并：

```text
╭─ FAILED ─────────────────────────────────────────────────────── 41s ─╮
│ 0 passed · 0 failed · 2 errored  (0 reused)                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ────────────────────────────────────── 2 errored attempts ─╮
│ ✗ @1K1P0VJAPVJ12  provider-errors/e2b  [agent]                       │
│   error: 401 Unauthorized — Invalid API key                          │
│   details: niceeval show @1K1P0VJAPVJ12                              │
│ ✗ @1MEMY3VCQ6B5B  provider-errors/vercel  [agent]                    │
│   error: 403 Forbidden — Team access is required                     │
│   details: niceeval show @1MEMY3VCQ6B5B                              │
╰──────────────────────────────────────────────────────────────────────╯
```

受控中断不是失败完成的别名：它显示 `INTERRUPTED`、以 `130` 退出；已发布 Attempt 仍可读，其余 reserved 或未开始 Planned attempt 不伪造 Attempt 结果。

退出码与 JUnit 是原 Runner 进程当时形成的交付物。之后发布且身份仍匹配的新 Run 只会进入新的 Inspection selection，不会追溯改写已经结束进程的退出状态或已归档 JUnit；已发布 Run 没有受支持的编辑 API。

## 对照版本发布门禁

前沿 Benchmark（如 SWE-bench 或复杂 Agent 评估）整体通过率通常不足百分之百。将这类实验作为 PR 门禁时，平台不能因存在 `failed` 题直接判红，而应基于固定的对照 Run 检查是否有非预期的能力回退（见 [REL-6](../../../user-story.md#周芷宁在发布前选出更合适的-agent-配置)）。

流程如下：

1. 运行候选 Experiment，取得本次生成的 Run ID。
2. 针对预先固定的对照 Run 执行对比检查：

   ```sh
   niceeval compare <baseline-run-id> -- <candidate-run-id> --max-regressions 0
   ```

3. 检查逐题配对结果。若候选 Run 在对照版本原本通过的题目上出现失败（`regressed`），命令输出退化题目明细并以退出码 `1` 阻断发布；若仅有偶发波动且 `regressed` 数量未超门限，则判定通过。

## 边界

- `--junit` 不是终端格式开关,与输出形态正交;它是 required reporter,写失败必须判红,不降级成 warning。
- 只有连形态都没能确定的 argv / 配置加载错误走 `stderr`。Human 显示真实 `error:`；有限且确定的命令语法
  错误可以附 `usage:`，不为外部服务或宿主运行条件枚举 `fix:`。
- budget 到顶时，正常闭合的 Invocation 仍是 `completion: "completed"`，但退出码为 `1`，不伪装全绿——流程见 [`--budget` 用例](budget-limit.md)。
- `--dry` 不创建 Invocation、Run、Member、Attempt 或 JUnit。

## 相关阅读

- [CLI · CI 门禁](../cli/README.md#ci-门禁) —— 门禁 case 的单源。
- [Runner · 完成状态](../../../runner.md#完成状态) —— Run 发布、`SIGINT` 与严格失败收尾。
- [`--json`(AI 循环)](machine-output-ai-fix-loop.md) —— 机器面的另一类消费者。
