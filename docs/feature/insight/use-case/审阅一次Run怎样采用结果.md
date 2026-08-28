---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 审阅一次 Run 怎样采用结果

用户需要从 Experiment Overview 追到 exact Attempt，并以完整证据决定怎样采用该 Run 的结果。Insight 从同一份
完整 Snapshot 读取所有层级；它不会用详情 JSON 替代数据库，也不会向 Record 写入标记。

```sh
niceeval view --run <run-id>
```

## 固定输入并选择要审阅的 Run

`--record` 固定已验证 Snapshot 的 exact Seal，重复的 `--run` 在该 Snapshot 中预选多个 Run；两者不改变页面
中继续以 URL 定位 Run 或 Attempt 的方式。它们不改变固定的 Human ready 输出：

```text
$ niceeval view --record ./snapshots/release.record-snapshot \
>   --run run_01J8KQ --run run_01J8KS --no-open
niceeval view — open in a browser:
http://127.0.0.1:43173/?session=local-session
```

自动化调用 `--json` 时，stdout 恰好是按发生顺序写出的 `niceeval.view-lifecycle/v1` NDJSON；没有人读前缀、
Snapshot bytes、Record facts、cookie 或可复用 credential。`ready` 给出 URL；关闭只写 protocol 与 event。URL 仍是
本机 session material，不能上传原始 stdout：

```json
{"protocol":"niceeval.view-lifecycle/v1","event":"ready","url":"http://127.0.0.1:43173/?session=local-session"}
{"protocol":"niceeval.view-lifecycle/v1","event":"closed"}
```

启动失败时同样只写一个终结 event，且不泄露未能打开的 Snapshot 内容：

```json
{"protocol":"niceeval.view-lifecycle/v1","event":"failed","code":"inspection-view-failed"}
```

读者在 Experiment → 可选 Eval 路径组 → Eval → Attempt table 中选择目标。Attempt member 保留 selected Run
identity，Run 本身不是独立层级。软导航把 Run 或 Attempt 详情放入 drawer/modal，同时保留 Overview、
Experiment selector 与语言。关闭详情或按 Back 会回到原表格；按 Forward 会恢复同一详情。

读者复制的 URL 是稳定深链接。在新标签或硬加载时，它显示完整 Run 或 Attempt 内容，不要求先打开
Overview，也不会显示没有背景的空 drawer。

Run debugger 显示该 Run 的身份、指标、判定、证据完整度与可比较关系。Attempt debugger 把 source 与 assertions、
trajectory、每次 tool input/output、timeline、usage、commands、diagnostics 和 diff 排成连续证据路径。读者可折叠
或展开 trajectory 与工具调用，并从 source 声明处查看对应 assertion 的输入、条件、观察值、权重与得分。

任一资料为 `partial`、`not-recorded` 或 `truncated` 时，对应区域显示状态、原因与已交付边界。Insight 不将
缺失事实填为成功，也不把读取限制伪装成完整结果。该路径只服务人的只读审阅与采用决定。
