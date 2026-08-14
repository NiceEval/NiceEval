# 准入健康（Admission health）—— Library

准入健康从 `niceeval/admission-health` 导出。它只能由会实际执行工作的 producer factory 挂到自己的
occurrence；`definePlugin()`、`defineEval()` 与 Assertion API 没有对应字段。

```ts
import { defineAdmissionHealth } from "niceeval/admission-health";

const endpointHealth = defineAdmissionHealth({
  namespace: "com.example.agent",
  name: "endpoint",
  behaviorRevision: "v1",
  timeoutMs: 5_000,
  async probe({ signal, occurrence }) {
    const response = await fetch(occurrence.endpoint, { signal });
    return response.ok
      ? { health: "healthy" }
      : { health: "unhealthy", code: "endpoint-rejected", message: response.statusText };
  },
});

export default defineSandboxAgent({
  admission: endpointHealth.occurrence({
    occurrenceKey: "primary",
    input: { endpoint: "https://agent.example.test/health" },
  }),
  // 其余 Agent 声明。
});
```

`occurrenceKey` 区分同一 producer definition 的两个实际位置。它不是数组下标，也不能包含凭据。
`probe()` 只返回健康判别或抛出具名失败；Runner 自己负责 deadline 与 slot 隔离。

```ts
declare function defineAdmissionHealth<const Input extends JsonValue>(
  input: AdmissionHealthDefinitionInput<Input>,
): AdmissionHealthDefinition<Input>;

interface AdmissionHealthDefinitionInput<Input extends JsonValue> {
  readonly namespace: string;
  readonly name: string;
  readonly behaviorRevision: string;
  readonly timeoutMs: number;
  readonly probe: (
    input: AdmissionHealthProbeInput<Input>,
  ) => Promise<AdmissionHealthDecision>;
}

interface AdmissionHealthDefinition<Input extends JsonValue> {
  readonly namespace: string;
  readonly name: string;
  readonly behaviorRevision: string;
  readonly timeoutMs: number;
  readonly occurrence: (input: AdmissionHealthOccurrenceInput<Input>) => AdmissionHealthOccurrence;
}

interface AdmissionHealthOccurrenceInput<Input extends JsonValue> {
  readonly occurrenceKey: string;
  readonly input: Input;
}

interface AdmissionHealthOccurrence {
  readonly kind: "admission-health-occurrence";
  readonly identity: AdmissionOccurrenceIdentity;
}

interface AdmissionHealthProbeInput<Input extends JsonValue> {
  readonly signal: AbortSignal;
  readonly occurrence: Readonly<Input>;
  readonly slot: AdmissionSlotRef;
}

interface AdmissionSlotRef {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}

interface AdmissionOccurrenceIdentity {
  readonly namespace: string;
  readonly name: string;
  readonly behaviorRevision: string;
  readonly occurrenceKey: string;
  readonly configDigest: string;
}

type AdmissionHealthDecision =
  | { readonly health: "healthy" }
  | {
      readonly health: "unhealthy";
      readonly code: string;
      readonly message: string;
    };
```

`namespace`、`name`、`behaviorRevision`、`occurrenceKey` 与规范化 `input` 的 digest 共同形成 occurrence
identity。改变其中任一值会形成另一个隔离边界。原始 input、URL、token、异常堆栈和响应 body 不进入
identity 或 Run 回执。

## 声明错误

| code | 条件 |
|---|---|
| `admission-health-invalid-timeout` | `timeoutMs` 不是有限正整数 |
| `admission-health-occurrence-key` | `occurrenceKey` 为空、重复或含 secret 标记 |
| `admission-health-definition-conflict` | 同一 producer occurrence 有两份健康 definition |
| `admission-health-plugin-owner` | Plugin 试图挂载 health declaration |

这些错误发生在 planning，零探测、零 Sandbox 创建、零 Attempt 写入。

## 使用边界

健康 declaration 只能描述 producer 接受一条 fresh slot 前的可用性。它不能读取 Eval 的 Assertion、改变
`test(t)`、修改 Verdict、请求重试或保存跨 Invocation 的健康值。需要证明输出正确时，仍在 Eval 内登记
真实 Assertion。
