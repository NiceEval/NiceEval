# Agent-as-Judge —— 架构

被测 Agent 与 Agent Judge 的运行形态独立。Sandbox Agent Judge 不进入被测 Sandbox；Runner 把显式授权的 sealed workdir snapshot 复制到新的裁判 Sandbox。Direct Agent Judge 不创建 Sandbox，也不能获得 workspace。

被测输出、仓库文件和工具结果都是不可信 evidence，不能覆写 rubric、Decision 协议或执行配置。裁判 Agent 使用自己的 Adapter 鉴权与进程条件，不继承被测 Agent 的凭据、Session、进程变量或网络权限。

## Managed investigation

一次 Judge Evaluation 拥有一个受管 investigation broker：

1. Runner 先 seal MaterialBindingManifest 与 workspace/tool/network capability。
2. Broker 创建独立 Judge Session 和可选 workspace copy。
3. 每次 command/tool 的 input 与 output 在进入 Agent 上下文前完成安全处理和预算检查；封口 representation 与 Agent 收到的 representation 相同。
4. 每笔调查形成 `InvestigationItemRef`，保存 kind、tool/command identity、input/output visible digest、bytes、coverage、limitations、顺序与 capability provenance。
5. Judge workspace 写入只是 evaluator-private 临时状态；生成文件只有被 broker 显式 capture 时才能成为 investigation item，永不升级为 Execution source。

每个调查项使用下面的穷尽形状：

```ts
type InvestigationKind = "tool" | "command" | "captured-file";

type InvestigationLimitation =
  | "known-secret-redacted"
  | "binary-rendered";

interface InvestigationRepresentation {
  readonly mediaType: string;
  readonly bytes: number;
  readonly visibleDigest: string;
  readonly coverage: "complete";
  readonly limitations: readonly InvestigationLimitation[];
}

interface InvestigationItem {
  readonly ref: InvestigationItemRef;
  readonly kind: InvestigationKind;
  readonly operationIdentity: string;
  readonly input: InvestigationRepresentation;
  readonly output: InvestigationRepresentation;
  readonly order: number;
  readonly capability: ManagedJudgeTool;
}
```

Broker 只发布 coverage complete 的 item。输出超出预算或 channel 中途丢失时，不发布 partial item，而是把整个 Evaluation 标成 `investigation-incomplete` unavailable。

Decision evidence 只能引用当前 manifest 的 presented source 或当前 Evaluation 的 investigation item。Dangling ref、owner/digest mismatch 或伪造 ref 是 `investigation-evidence-invalid` error。

Broker stream 丢失、无法同形封口、预算耗尽或 capability escape 是 `investigation-incomplete` unavailable，不转成 `0`。

Adapter 无法完整 capture 的 tool/result channel 不得暴露给 Agent Judge。Unmanaged shell 或 network result 不能先进入 Agent 上下文，再以“Decision 未引用”为由逃过审计。

合法 Decision 只有有限 `[0,1]` measurement、公开 rationale 和 evidence refs。系统不保存隐藏思维链。运行错误不能转换为 `0`。参与 score 或 control 的 Decision 不可用时，Score grading 保存 `partialScore` 并不可排名；record-only Decision 的 Issue 不作废正式 score。

没有可信 workspace-access producer 时，系统只能审计完整 workspace authorization，不能声称 Agent 实际读取了哪些文件。Judge Evaluation seal 后才删除临时 workspace；普通 cleanup diagnostic 不改 Decision，必要 evidence 无法封口时则不发布 Evaluation。

show 和 view 从 AssertionResult 显示 measurement、threshold、rationale 和 evidence 摘要，不重新启动裁判 Agent。
