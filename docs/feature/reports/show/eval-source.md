# `--source`：把断言放回源码

`--source` 是 attempt-detail 组件族对应区块的 text 面，显示运行时保存的 eval 源码，而不是工作树中可能已经修改过的文件。两类调用行有标注：

- **断言行**：通过与失败断言标在对应行；失败行紧跟分组、matcher、期望值和实际值。期望值与实际值经摘要收口（折单行、设上限）——标注是源码页里的一行事实。落盘的 `expected` / `received` 本身是[有界预览](../../scoring/architecture.md)，attempt 首页按原始换行展开这份预览，原始证据在 `events.json` / `diff.json` 等 artifact（存在时才可回溯，不是每条断言都有）。
- **send 行**：`t.send(...)` 的调用行标注它产生的 turn 的头行事实——[轮标签](../../scoring/library/display.md#turntsend的展示)（与 [`--execution`](execution.md) 的 turn 头行、[`--timing`](timing.md) 的 turn 节点、diff 的 `windows` 同一枚 token）、status、该轮墙钟与该轮 usage（有记录才出现），失败轮标 `✗`。一行源码触发多轮（循环里 send）时逐轮标注。回复全文与轮内工具卡片不内联——源码视图回答「这行代码对应哪一轮、这一轮成了没成」，「这一轮做了什么」归 [`--execution`](execution.md)。

```sh
niceeval show @1qrdcfq8 --source
```

```text
26      await t
27✓       .send(
    turn1 · completed · 3m 11s
38      for (const [issue, label] of Object.entries(expected)) {
39        await t.group(`Issue ${issue}: selected proposal matches the accepted proposal`, async () => {
40✗         t.check(Number(decisions[issue]?.selected_proposal_id), equals(label.selected_proposal_id));
    gate · Issue 15193: selected proposal matches the accepted proposal ·
    equals(4) · expected 4 · received 3
41        });
42      }
```

send 行的定位来自事件流里用户消息的源码位置，标注在能定位到行的轮上尽力而为：attempt 在事件记录建立前失败、或 send 发生在别的源码文件里时，该轮没有这条标注，断言标注照常；轮次全量清单永远在 [`--execution`](execution.md)。断言的 never-drop 契约（unmapped 桶）不适用于 send 标注——断言的诊断面就是 `--source`，轮次的诊断面是 `--execution`，源码页上的 turn 标注只是跨面指针。

被收口的值必须有「更进一步」：有未通过断言时，`--source` 末尾在 `full eval source` 之前给出 `full failure detail: niceeval show @<locator>`——[attempt 首页](attempt.md)把每条失败落盘的 expected / received 预览按原始换行展开（含 `commandSucceeded()` 的 `output tail:` 段），再往下是 `result.json` / `events.json` 里的原始证据。收口只压缩展示面，不切断取证链。

长行会截断，末尾的 `full eval source` 给出取全文的两步路径：attempt 级 `sources.json` 是 `{path, sha256}` 引用列表，正文按哈希存在快照级 `sources/<sha256>.json`（见 [Results · sources.json](../../results/architecture.md#sourcesjson)）；脚本消费直接用 `AttemptHandle.sources()` 拿拼好的 `{path, content}`，不用自己做两步解析。

## 相关阅读

- [失败诊断首页](attempt.md) —— 完整 expected / received 的展开处。
- [Scoring · 断言与 Turn 的展示](../../scoring/library/display.md) —— 标注语法的单点定义。
