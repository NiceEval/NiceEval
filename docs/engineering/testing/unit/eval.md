# Eval 与 Context 怎么测

契约出处：[Eval](../../../feature/eval/README.md)、[Library](../../../feature/eval/library.md)、[Context](../../../feature/eval/library/context.md) 与 [执行错误分类](../../../feature/error-classification/README.md)。本篇只登记 Context 这条稳定 seam；Record transport 归 [record.md](record.md)，真实 Agent 接线归 [E2E Adapter](../e2e/adapter/README.md)。

自动化产品测试当前处于重置期。恢复 Unit 前必须重新取得测试预算；本页定义未来测试的 owner、fixture 和最小证明面，不授权现在新增测试文件。

## 观察面与边界

从 Eval 作者实际读取的 `t`、session、turn、Sandbox capability 与 Agent 收到的 `TurnInput` 观察。scripted
Agent 只返回预设 Turn，并把输入写入自己的 received 数组；它不实现 session 续接、重试、断言或固定
family 的持久化算法。

```ts
interface ScriptedAgent extends Agent {
  readonly received: TurnInput[];
}

function scriptedAgent(turns: readonly Turn[]): ScriptedAgent {
  const received: TurnInput[] = [];
  let cursor = 0;
  return {
    name: "scripted",
    kind: "direct",
    received,
    async send(input) {
      received.push(input);
      const turn = turns[cursor++];
      if (turn === undefined) throw new Error("fixture has no turn");
      return turn;
    },
  };
}
```

文件系统使用每例独立临时目录。Sandbox fake 只把公开命令、上传和生命周期调用写入检查数组；外部基础设施不 fake。类型能力由 typecheck fixture 验证，运行时 guard 仍验证非类型化输入。

## 最小证明面

- **发现与 identity**：文件/目录入口得到稳定 Eval identity；重名明确失败，不按扫描顺序替换。
- **Turn 与 session**：reply、events、usage 和 sessionId 反映当前 Turn；主 session 与子 session 的输入续接隔离，但 Attempt-owned 运行事实仍归同一 Attempt。
- **HITL**：request 必须唯一对位；无法对位时先失败且不发送响应。
- **Sandbox capability**：只有声明能力的构造路径暴露 Sandbox；上传、命令与路径基于真实调用顺序，不建立额外 phase 状态机。
- **受理与重试**：可信 `Turn.status = "failed"` 是领域终态；transport/CLI/signal 失败才形成 `SendFailure`。只有可证明的 `acceptance: "rejected"` 且分类为 retryable 才可重发。
- **固定事实边界**：Context 只交付 Agent 生命周期的事件和身份；它不能写入任意 JsonValue、注册
  schema 或创建新的持久 family。conversation、tool、retry、diagnostic、usage 与 timing 由固定
  collector 或 Assertions owner 定义。
- **Verdict 边界**：progress、diagnostic 和运行事实不改变 Turn status 或 Verdict；Assertion/Judge
  的完整判定矩阵归 assertions owner。

## Record 与 Reports 的接线

Context 不构造 `RunDocument`、`MemberDocument` 或 `AttemptDocument`。`experimentHost` 内的 Runner 把
生命周期结果交给 `recordHost`，由 Host seal 并发布完整 Run；大内容通过 owner-local blob closure。
随后 `analysisHost` 签发 Sample，Report 只通过 `aggregate()` / `query()` 读取闭合结果。

安装 manifest、conversation 和 telemetry 都是固定 family 的业务数据，不进入 Attempt Core，也不依赖
旧版 payload、图事件或读取 revision。

## 不这样测

- 不让 fake Agent 实现 session、retry、family decoder、Host 或 planner。
- 不断言私有 DTO、文件布局或完整字符串 snapshot。
- 不恢复 Results 1–15 的容器、图模型、防伪或历史 fixture。
- 删除任一未来测试时，必须说明会放走哪条当前契约；旧实现行为不是保留理由。
