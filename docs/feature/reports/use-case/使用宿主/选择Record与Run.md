# `--record` / `--run`：选择另一份 Record，或只看一份 Run

## 解决什么问题

show 与 view 默认打开项目的 Record。
当事实位于另一份可信 Record，或只想审计一个 Run 时，使用显式 Record 输入或 Run reference；二者都先固定到一个 `RecordGraphRef`，再 materialize 一份 sources 只有该项的 Sample。

## 全流程

1. 打开另一份 Record：

   ```bash
   niceeval view --record ./shared-record
   niceeval show --record ./shared-record
   ```

2. 只选择一个 Run：

   ```bash
   niceeval view --run compare/candidate@r17
   niceeval show --run compare/candidate@r17
   ```

3. host 识别输入后，打开固定 `RecordGraphRef`、materialize 单 source Sample，再运行 ReportPlan。
   复制出来的 target 保留 `--record` 或 `--run`，不会丢失 provenance 上下文。

## 边界

- 不能打开、验证或识别明确指定的 Record/Run 时，命令非零退出。
- 读取从不迁移、改写或推进源 Record。
- 要任意合并或收窄已生成的 Sample，使用 `narrowSample()` 或 `unionSamples()`；不要让 host 通过路径扫描私自选择成员。

## 相关阅读

- [View](../../view.md) —— Record、范围与静态交付。
- [Show](../../show.md) —— 终端 target。
- [Sample Library](../../../sample/library.md) —— 固定 source 集合与已定选择。
