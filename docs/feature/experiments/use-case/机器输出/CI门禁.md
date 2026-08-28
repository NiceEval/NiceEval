---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# CI 门禁:退出码、JUnit 与人读日志

## 解决什么问题

把 eval 挂成 PR 门禁或夜间任务后,消费者变成两个:按退出码判红绿、按 JUnit 做注解的 CI 平台,和事后翻日志页的人。
niceeval 不需要专门的 CI 档——日志页给人看,默认的人读文本在非 TTY 下自动是只追加流(无 ANSI、失败带 locator、空闲 30 秒心跳防平台误杀);平台注解走 `--junit`;需要 JSON 汇总时在运行后读结果面,不解读运行日志。

## 全流程

1. 门禁命令钉报告路径:

   ```sh
   niceeval exp ci --junit ./niceeval-junit.xml
   ```

2. 日志是人读追加流,整流走单一 `stdout`——CI runner 分开缓冲两个 OS stream 也不会把失败行和结束摘要打乱序([流边界](../../cli.md#输出流和落盘节奏))。
   需要机器消费运行事件(自建注解 adapter、实时看板)时加 [`--json`](../../cli.md#机器怎么读--json) 换成 NDJSON,两种形态事实一致。
3. 门禁只认退出码:`0` 全部通过且运行完整完成计划;`1` 有 `failed` / `errored`、budget 未完成计划或 required reporter 写失败;`2` 未捕获崩溃;`130` 中断。
   折叠规则见 [Runner · 退出码](../../../../runner.md#退出码)。
4. 归档文件：`--junit` 是整次运行的最终聚合，收尾时写临时文件并原子替换目标——CI 归档到的要么是完整文件，要么不存在。
   Run create 后立即可见；每个 Attempt 以独立 transaction 原子发布 closure、publication identity 与 slot binding。`SIGINT` 保留已发布 Attempt，并以 `interrupted-before-publication` 收口其余 slot。
   需要 JSON 汇总时，归档 receipt，再以 `createdRunIds` 与 `publicationCutoff` 构造固定 query request。
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
│ niceeval view --run 8f3d6f62-1d34-4cf3-99c7-84ba3c483706             │
╰──────────────────────────────────────────────────────────────────────╯
```

断言未通过或 execution error 保持非零；后者逐 Attempt 保留安全封口后的真实错误和所属 Run 的下钻，不把不同错误合并：

```text
╭─ FAILED ─────────────────────────────────────────────────────── 41s ─╮
│ 0 passed · 0 failed · 2 errored  (0 reused)                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ────────────────────────────────────── 2 errored attempts ─╮
│ ✗ @1K1P0VJAPVJ12  provider-errors/e2b                                │
│   error: 401 Unauthorized — Invalid API key                          │
│   details: niceeval view --run <run-id>                              │
│ ✗ @1MEMY3VCQ6B5B  provider-errors/vercel                             │
│   error: 403 Forbidden — Team access is required                     │
│   details: niceeval view --run <run-id>                              │
╰──────────────────────────────────────────────────────────────────────╯
```

受控中断不是失败完成的别名：它显示 `INTERRUPTED`、以 `130` 退出；已发布 Attempt 仍可读，其余 reserved 或未开始 slot 不伪造 Attempt 结果。

退出码与 JUnit 是原 Runner 进程当时形成的交付物。之后发布且身份仍匹配的新 Run 只会进入新的 Inspection selection，不会追溯改写已经结束进程的退出状态或已归档 JUnit；已发布 Run 没有受支持的编辑 API。

## 边界

- `--junit` 不是终端格式开关,与输出形态正交;它是 required reporter,写失败必须判红,不降级成 warning。
- 只有连形态都没能确定的 argv / 配置加载错误走 `stderr`。Human 显示真实 `error:`；有限且确定的命令语法
  错误可以附 `usage:`，不为外部服务或宿主运行条件枚举 `fix:`。
- budget 到顶时，正常闭合的 Invocation 仍是 `completion: "completed"`，但退出码为 `1`，不伪装全绿——流程见 [`--budget` 用例](../预算上限.md)。
- `--dry` 不创建 Invocation、Run、Member、Attempt 或 JUnit。

## 相关阅读

- [CLI · CI 门禁](../../cli.md#ci-门禁) —— 门禁 case 的单源。
- [Runner · 完成状态](../../../../runner.md#完成状态) —— Run 发布、`SIGINT` 与严格失败收尾。
- [`--json`(AI 循环)](AI修复循环.md) —— 机器面的另一类消费者。
