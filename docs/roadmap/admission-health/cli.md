# 准入健康（Admission health）—— CLI

准入健康不增加独立命令。它扩展既有 `niceeval exp` 的 plan、运行反馈与 Run receipt；没有
`niceeval admission`、`--health-retry` 或按 health value 查询历史的命令。

## Dry

```sh
niceeval exp compare/codex --dry
niceeval exp compare/codex --dry --json
```

dry 只显示 declaration 和 occurrence identity 的安全摘要：

```text
ADMISSION DECLARATIONS
compare/codex  com.example.agent/endpoint@v1  occurrence primary  timeout 5000ms
```

它不调用 `probe()`、不启动计时器、不建立 Invocation，也不写 Run。`niceeval debug` 以一个
`admission-health` phase 标出该动作，但不虚构网络命令。

## 人读反馈

每次真实探测结束后，TTY 显示 slot、occurrence、阶段和值。人读输出不显示请求 body、响应 body、token 或
原始异常堆栈。

```text
admission  compare/codex memory/recall #0  endpoint/primary  healthy
admission  compare/codex memory/recall #1  endpoint/primary  unhealthy: endpoint-rejected
admission  endpoint/primary isolated  6 unstarted slots
```

结束摘要以 `evaluated`、`errored`、`not-run` 三项列出完整计数。健康为 `unhealthy` 的 slot 仍归
`evaluated`；它没有 Attempt locator 或 Verdict。

## JSON 与退出码

`--json` 输出 NDJSON。最后一条 Invocation receipt 引用 Run；Run 内的 admission receipt 是可长期读取的
业务事实。

```json
{"type":"admission-health","runId":"01J...","slotId":"s0","occurrence":"com.example.agent/endpoint@v1#primary","state":"evaluated","health":"healthy"}
{"type":"admission-health","runId":"01J...","slotId":"s1","occurrence":"com.example.agent/endpoint@v1#primary","state":"not-run","reason":"occurrence-isolated"}
```

| 结果 | `niceeval exp` 退出行为 |
|---|---|
| 所有探测为 `healthy`，Invocation 完整且没有 `failed` / `errored` | `0` |
| 探测不健康、超时、抛错或隔离了 slot；或有 `failed` / `errored` | `1` |
| argv、selector 或 admission declaration 无法建立 Invocation | `1` |
| 未捕获崩溃 / 受控中断 | `2` / `130` |

本方向继承 [CLI 的统一 `niceeval exp` 退出码](../../cli.md#退出码)，不新增 admission 专用状态码。
退出码 `1` 不把 `unhealthy` 伪装成 Eval `failed`；机器调用方读取 Run receipt 取得每个 slot 的原因。

## 并发与审计边界

探测在已取得 fresh-slot 调度名额后运行，并计入该 Experiment 的并发限制。它不建立 Attempt，因此不进入
Attempt 并发计数或 Verdict 汇总。不同 occurrence 可以并发；同一 occurrence 的已开始探测不被另一条失败
探测中止，尚未开始的 slot 一律写 `occurrence-isolated`。

CLI 只显示 Run-owned 回执的安全字段。完整诊断由 producer 明确写入自己的受控 attachment；终端、JSON 和
Report 都不得从网络错误文本猜补缺失字段。
