# `--record` / `--run`:换记录根,或只看一份 Run

## 解决什么问题

`show` 与 `view` 默认读当前项目的记录根,但结果不总在原地:一类是可信边界内搬动的事实根拷贝——比如整个 `.niceeval/` 作为 CI job artifact 取回本机,搬目录即可,不经发布管线;另一类是 [`publish`](../../../record/library.md#发布publish) 为对外发布构出的发布根。
两类都是普通记录根目录,两个宿主都用 `--record` 打开。
调试一次历史执行时,整根里几十份 Run 又太吵,`view --run` 可以只装载一份 Run 文件。
两个 flag 都不占用位置参数([契约](../../view.md#打开与收窄))。

## 全流程

1. 对着别的目录打开。
   `--record <dir>` 在 `show` 与 `view` 是同一个 flag,改变的都是记录根:

   ```bash
   niceeval view --record site-data/run  # 换记录根
   niceeval show --record tmp/published-results
   ```

   `show` 输出的页索引命令会保留 `--record`,复制粘贴不丢上下文。

2. 只看一份历史 Run,不让根里其它结果混进 Sample:

   ```bash
   niceeval view --run .niceeval/dev-e2b_codex-e2b/2026-07-12T10-08/run.json
   ```

3. 扫描整个记录根时容错：单个不可读 Run 不会挡住其它结果。
   每个被跳过的 Run 形成一条 `unreadable-run` Sample Issue（含目录与原因），由页内 `SampleNotices` 显示。
   非 niceeval JSON 直接忽略；schemaVersion 不兼容或内容损坏时，当前 Notice policy 决定说明与 action（[逐场景行为表](../../view.md#结果版本与错误)）。

4. `show` 侧完全没有可读结果时命令非零退出,并对带 `producer.version` 的旧格式给出对应版本的 `npx niceeval@<version> show --record <root>` 建议([契约](../../show.md#无匹配与不可读结果))。

## 边界

- `view --run` 明确指定单个 Run 文件时,该文件不可读会让命令失败——明确点名的东西坏了不静默跳过。
- 读取不会迁移或改写历史结果。
- 收窄只有前缀语义。
  按任意谓词挑选 Run、按证据种类瘦身,先用 [`publish`](../../../record/library.md#发布publish) 构建发布根,再对发布根打开或导出([用例](../交付报告/导出静态站.md))。

## 相关阅读

- [View · 结果版本与错误](../../view.md#结果版本与错误) —— 不可读 Run 的逐场景行为表。
- [Show · 无匹配与不可读结果](../../show.md#无匹配与不可读结果) —— 终端侧的同一套规则。
- [Record Lib](../../../record/library.md) —— `openRecord`、`publish` 与记录根的脚本消费。
