# CI 门禁:退出码、JUnit 与人读日志

## 解决什么问题

把 eval 挂成 PR 门禁或夜间任务后,消费者变成两个:按退出码判红绿、按 JUnit 做注解的 CI 平台,和事后翻日志页的人。niceeval 不需要专门的 CI 档——日志页给人看,默认的人读文本在非 TTY 下自动是只追加流(无 ANSI、失败带 locator、空闲 30 秒心跳防平台误杀);平台注解走 `--junit`;需要 JSON 汇总时在运行后读结果面,不解析运行日志。

## 全流程

1. 门禁命令钉严格判定和报告路径;日志语言在 `niceeval.config.ts` 里用 `locale: "en"` 钉死,不在命令行传环境变量:

   ```sh
   niceeval exp ci \
     --strict \
     --junit .niceeval/junit.xml
   ```

2. 日志是人读追加流,整流走单一 `stdout`——CI runner 分开缓冲两个 OS stream 也不会把失败行和结束摘要打乱序([流边界](../../cli.md#输出流和落盘节奏))。需要机器解析运行事件(自建注解 adapter、实时看板)时加 [`--json`](../../cli.md#机器怎么读--json) 换成 NDJSON,两种形态事实一致。
3. 门禁只认退出码:`0` 全部通过且运行完整覆盖计划;`1` 有 `failed` / `errored`、budget 未覆盖计划或 required reporter 写失败;`2` 未捕获崩溃;`130` 中断。折叠规则见 [Runner · 退出码](../../../../runner.md#退出码)。
4. 归档产物:`--junit` 是整次运行的最终聚合,收尾时写临时文件并原子替换目标——CI 归档到的要么是完整文件,要么不存在。attempt 级 Run 逐个原子落盘,进程中断时已完成的照常可读(见 [CLI · 输出流和落盘节奏](../../cli.md#输出流和落盘节奏))。需要 JSON 汇总交给自建看板时,运行后 `niceeval show --json > summary.json`——读结果面拿到的比任何运行期汇总文件都全。注意口径:`show --json` 读的是记录根的现刻水位(含携带与历史 Run),fresh checkout 的 CI 上等于本次运行;记录根跨运行持久(nightly 缓存 `.niceeval/`)时,用 `--exp` / `--fresh` 收窄到本次条件与新执行。
5. JUnit 交给平台做测试注解;完整记录以文件和 Run 为准。

## 边界

- `--junit` 不是终端格式开关,与输出形态正交;它是 required reporter,写失败必须判红,不降级成 warning。
- 只有连形态都没能确定的 argv / 配置加载错误走 `stderr`(人读 `error:` + `fix:` 两行)。
- budget 到顶时结论是 `incomplete`、退出码 `1`,不伪装全绿——流程见 [`--budget` 用例](../预算上限.md)。
- `--dry` 不创建 Run 或 JUnit。

## 相关阅读

- [CLI · CI 门禁](../../cli.md#ci-门禁) —— 门禁 case 的单源。
- [Runner · 完成状态](../../../../runner.md#完成状态) —— `complete` / `incomplete` / `interrupted` 怎样进结论。
- [`--json`(AI 循环)](AI修复循环.md) —— 机器面的另一类消费者。
