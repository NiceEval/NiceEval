# 把终端里看到的结果交给脚本

## 用户目标

周芷宁的自动修复循环要读取一次失败 Attempt 的判定与用量，再交给 coding agent 修改（[REL-5](../../../user-story.md)）。她先在终端用 `niceeval show` 找到要看的内容，希望脚本拿到同一份数据，而不必再学一套 request 写法；脚本读到的数字也必须和终端显示的一致（[AUD-5](../../../user-story.md)）。

## 起始状态

- 项目里已经发布了 Experiment `main` 的结果，其中 `@01JSHOWATTEMPT` 是一条 `failed` Attempt。
- 脚本运行在同一个项目目录，能执行 `niceeval`。

## 完整路径

1. 在终端查看这条 Attempt 的用量。`show` 输出人读的总费用、模型用途和调用明细，末尾给出浏览器入口 `Open: niceeval view @01JSHOWATTEMPT`。 {#read-text}

   ```sh
   niceeval show @01JSHOWATTEMPT --usage
   ```

2. 加上 `--json`（或 `-o json`），同一条命令改为输出 `attempt.usage` 的 `niceeval.query/v3` document，一行一个，没有标题、表格或提示行。 {#same-command-json}

   预期输出（摘要）：

   ```text
   $ niceeval show @01JSHOWATTEMPT --usage --json
   {"protocol":"niceeval.query/v3","outcome":"success", … }
   ```

3. 脚本需要判定和用量两部分时，去掉投影 flag。`@<locator>` 依次调用 `attempt.get` 与 `attempt.usage`，输出两行，它们来自同一个 `PublicationCutoff`。 {#attempt-two-lines}

   ```sh
   niceeval show @01JSHOWATTEMPT --json | wc -l
   ```

   预期输出：`2`。

4. 脚本需要断言明细时，使用 `--assertions` 投影。默认以紧凑 `compact` 摘要输出，避免超大材料撑爆管道。 {#attempt-assertions}

   ```sh
   niceeval show @01JSHOWATTEMPT --assertions --json
   ```

5. 核对这份数据与 machine 入口一致：以同一 request 调用底层 `query run`，两边逐字相同，`diff` 不输出任何内容。 {#same-as-query}

   ```sh
   diff \
     <(niceeval show @01JSHOWATTEMPT --usage --json) \
     <(niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.usage","locator":"@01JSHOWATTEMPT"}}')
   ```

## 结果

脚本拿到的数据与终端显示的出自同一组 operation 和同一个 cutoff，不需要另写解码或换算。`show --json` 不新增任何 result shape；`show` 没有投影的 operation（如 `attempt.assertion.image`）仍只经 `query` 读取。

| 情形 | 用户看到的结果 |
| --- | --- |
| locator 未命中 | stderr 写英文诊断，进程非零退出，stdout 没有任何行 |
| 某个 operation 返回 `outcome: failure` | 该行照常写出，后续 operation 不再调用，退出状态与 `query run` 相同 |
| `niceeval show --all -o json` | 用法错误：`--all` 只控制文本展开 |
| `niceeval show -o csv` | 用法错误：`-o` 只接受 `text` 与 `json` |

## 相关契约

- [Inspection CLI · 输出格式](../cli.md#输出格式) —— `-o json` 的 operation 顺序与失败语义。
- [Inspection CLI · machine 输出与错误面](../cli.md#machine-输出与错误面) —— `InspectionDocument` 与 stderr 的分工。
