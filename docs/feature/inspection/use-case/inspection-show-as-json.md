# 把终端里看到的结果交给脚本

## 用户目标

周芷宁的自动修复循环要读取一次失败 Attempt 的判定与用量，再交给 coding agent 修改（[REL-5](../../../user-story.md)）。她先在终端用 `niceeval show` 找到要看的内容，希望脚本拿到同一份数据，而不必再学一套 request 写法；脚本读到的数字也必须和终端显示的一致（[AUD-5](../../../user-story.md)）。

## 起始状态

- 项目里已经发布了 Experiment `main` 的结果，其中 `@01JSHOWATTEMPT` 是一条 `failed` Attempt。
- 脚本运行在同一个项目目录，能执行 `niceeval`。

## 完整路径

1. 在终端查看这条 Attempt 的用量。`show` 输出人读的总费用、模型用途和调用明细，末尾给出浏览器入口 `Open: niceeval view @01JSHOWATTEMPT usage`。 {#read-text}

   ```sh
   niceeval show @01JSHOWATTEMPT usage
   ```

2. 加上 `--json`，同一条命令改为输出 `attempt.usage` 的 `niceeval.inspection/v1` document，一行一个，没有标题、表格或提示行。 {#same-command-json}

   预期输出（摘要）：

   ```text
   $ niceeval show @01JSHOWATTEMPT usage --json
   {"protocol":"niceeval.inspection/v1","outcome":"success", … }
   ```

3. 脚本需要判定和用量两部分时，去掉方面词。`@<locator>` 依次调用 `attempt.get` 与 `attempt.usage`，输出两行，它们来自同一个 `PublicationCutoff`。 {#attempt-two-lines}

   ```sh
   niceeval show @01JSHOWATTEMPT --json | wc -l
   ```

   预期输出：`2`。

4. 脚本需要断言明细时，使用 `assertions` 方面。默认以紧凑 `compact` 摘要输出，避免超大材料撑爆管道。 {#attempt-assertions}

   ```sh
   niceeval show @01JSHOWATTEMPT assertions --json
   ```

5. 脚本顺着 document 的 `links` 下钻，不拼命令、不写 request。按 `rel` 取出失败断言的命令，加 `--json` 原样执行，得到这条断言的详情。 {#follow-links}

   ```sh
   niceeval show @01JSHOWATTEMPT assertions --json \
     | jq -r '.links[] | select(.rel == "assertion") | .command' | head -n 1
   ```

   预期输出：`niceeval show @01JSHOWATTEMPT ae_5c8e2a0f7d3b1e6c9a4f --full`，与终端文本 `Next` 中的命令逐字相同。

## 结果

脚本拿到的数据与终端显示的出自同一组 operation 和同一个 cutoff，不需要另写解码或换算。`show --json` 不新增任何 result shape；每个固定 operation 都能由一条 `show` 命令到达，`attempt.assertion.image` 把字节写入 `--output` 指定的文件。

| 情形 | 用户看到的结果 |
| --- | --- |
| locator 未命中 | stderr 写英文诊断，进程非零退出，stdout 没有任何行 |
| 某个 operation 返回 `outcome: failure` | 该行照常写出，后续 operation 不再调用，进程非零退出 |
| `niceeval show --all --json` | 用法错误：`--all` 只控制文本展开 |
| `niceeval show @01JSHOWATTEMPT timing fc_3f90…` | 用法错误：方面与 ID 前缀不符，诊断列出 Attempt 可用的方面 |
| `niceeval show -o csv` | 用法错误：`-o` 只接受 `text` 与 `json` |

## 相关契约

- [Inspection CLI · 输出格式](../cli.md#输出格式) —— `--json` 的 operation 顺序与失败语义。
- [Inspection CLI · 下一步与 links](../cli.md#下一步与-links) —— `rel` 枚举与命令形态。
- [Inspection CLI · machine 输出与错误面](../cli.md#machine-输出与错误面) —— `InspectionDocument` 与 stderr 的分工。
