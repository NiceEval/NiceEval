# 编写 Adapter

一个 Adapter 只负责两件事：驱动自己的被测对象，并把原始行为归一成 `Turn`。
先实现最小 `send`，再按 eval 实际需要补充事件、会话、HITL 和 tracing。

## 递进实现

| 步骤 | Adapter 增量 | 解锁的 eval 行为 |
|---|---|---|
| 收发消息 | 只在取得可信协议终态时返回真实 `status` / `data`；执行异常 reject `SendFailure` | 单轮发送、结构化输出、`succeeded` |
| 标准事件流 | 完整转换消息、工具、结果与 usage | 消息、工具和事件断言 |
| 多轮会话 | 使用 typed session slot 或 `id` / `capture()` | 连续发送和 `newSession()` |
| HITL | waiting、`input.requested`、按 request ID 恢复 | `t.check(turn.status, equals("waiting"))`、`requireInputRequest`、`respond` |
| tracing | exporter 配置与 span mapper | trace artifact 和 view 瀑布图 |

这五步表示 Adapter 文件实现了多少行为；Tier 1/2/3 表示接入需要对被测应用做多少修改。
两套坐标彼此正交。

被测对象是 Sandbox CLI 时，再加一份 ensure 声明（目标 identity 加只读 探测）——这是 Adapter 在 Sandbox 内的全部准备义务。
第三方 Adapter 写协议加 ensure 声明就是完整的纯适配；安装由按 identity 配对的官方 Agent 安装层承担，需要自管分发渠道时随包导出自己的安装层（见 [Agent Ensure](../architecture/agent-ensure.md)）。

## 组织 `send`

把 `send` 拆成三个可单测的函数，主函数只负责编排：

```text
transport ─► reducer ─► session / HITL orchestration ─► Turn
```

### 1. 写 transport

写一个只负责调用对象的函数，传入 `ctx.signal`，返回原始响应、frame cursor 或 transcript。
URL、鉴权、请求体和 CLI 参数留在这里。
transport 必须同时保存受理事实与进程终态：能证明 admission 拒绝才写 `acceptance: "rejected"`，已经出现服务端处理或 agent 事件写 `started`，其余写 `unknown`。自然语言、空事件和退出码不能代替这个判定。

### 2. 选择 reducer

优先从 [`sdk/`](../sdk/README.md) 选择官方转换器；没有转换器时写一个只接受 fixture 数据的纯映射函数。

根据输入形态选择写法：

- **完整单元事件**：一帧已经包含完整消息或工具生命周期片段，逐帧映射即可。
- **增量 delta**：文本和工具参数需要按 call ID/index 累积，到结束信号才落地；优先用协议官方 reducer，其次用 `deltaStream`。

### 3. 在 `send` 中接入会话

在 `send` 中使用 `ctx.session` 读取或提交历史、捕获 ID，并在暂停时保存 cursor。
直接套用 [使用会话与 HITL](sessions-and-hitl.md) 的对应示例。

Reducer 只有在协议给出完整 terminal frame 时构造 `Turn`。`completed` / `waiting` / `failed` 都是可信终态；进程非零、signal、transport 中断或缺 terminal frame 时构造并 reject `SendFailure`，由 core 统一分类和重试。不要把执行异常压成 `Turn.failed`，也不要在 Adapter 内整段重发输入。

需要 trace 时，把 `ctx.telemetry.headers` 传给 transport；不要在 reducer 里从 span 生成行为事件。
内部数据流见 [Architecture](../architecture.md#数据流)。

## 完整性优先

正断言缺数据会失败，负断言缺数据可能静默通过。
Adapter 不应为了“看起来支持工具断言”而只映射容易取得的成功事件。
无法证明完整时，应明确说明限制并让 eval 避免使用对应负断言。
见 [Architecture · 断言证据与完整性](../architecture/evidence.md)。

## 组合与发现

niceeval 不维护按字符串名称查找 Agent 的运行时注册表。
Adapter 是普通 TypeScript 值，由 experiment 直接 import：

```ts
import { defineExperiment } from "niceeval";
import agent from "../agents/support.ts";

export default defineExperiment({ agent, attempts: 3 });
```

要比较 Agent 或模型，定义不同 experiment 并复用同一个 factory。
名字用于结果标识和路由，不用于 core 按供应商分支。

## 下一步

- 被测对象是服务或 SDK endpoint：[Direct Agent](direct-agent.md)
- 被测对象是隔离 Sandbox 里的 CLI：[Sandbox Agent](sandbox-agent.md)
- 需要消费 SSE、delta 或 transcript：[流式协议与共享工具](streaming.md)
