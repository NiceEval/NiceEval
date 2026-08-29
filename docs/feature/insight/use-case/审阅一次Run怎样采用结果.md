---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 审阅一次 Run 怎样采用结果

用户从 Experiment Overview 追到 exact Attempt，并以完整证据决定怎样采用该 Run 的结果。Run 无需先进入终态；Insight
在一个 `PublicationCutoff` 下同时展示已发布 Attempt、active pending 或 terminal absence。

```sh
niceeval view --run <run-id>
```

## 选择要审阅的 Run

重复 `--run` 预选多个 exact Run；它不改变 Human ready 输出：

```text
$ niceeval view --run run_01J8KQ --run run_01J8KS --no-open
niceeval view — open in a browser:
http://127.0.0.1:43173/?session=local-session
```

自动化调用 `--json` 时，stdout 只包含 `niceeval.view-lifecycle/v1` NDJSON：

```json
{"protocol":"niceeval.view-lifecycle/v1","event":"ready","url":"http://127.0.0.1:43173/?session=local-session"}
{"protocol":"niceeval.view-lifecycle/v1","event":"closed"}
```

URL 是本机 session material。启动失败只写终结 event，不泄露 Run facts：

```json
{"protocol":"niceeval.view-lifecycle/v1","event":"failed","code":"inspection-view-failed"}
```

Run debugger 只消费 `run.get`，显示 identity、state、expected/published/missing、coverage、指标分母、slot binding、
Attempt locator，以及 active pending 或 terminal absence。这样读者能区分“尚未发布完”“终态缺席”和“已发布指标较差”。

Attempt debugger 把 source、assertions、trajectory、tool input/output、timeline、usage、commands、diagnostics 和 diff 排成
连续证据路径。软导航保留 Overview；深链接硬加载同一详情。partial、unavailable 或 truncated 会显示状态、原因与边界，
不会被填成成功或完整结果。
