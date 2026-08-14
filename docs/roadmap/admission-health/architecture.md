# 准入健康（Admission health）—— Architecture

## 数据建模

一个 Run 持有零到多个 admission occurrence。每个 occurrence 对应零到多个 fresh slot。回执只属于 Run，
不嵌入 Attempt；这样未获准的 slot 仍有可审计事实。

```ts
interface AdmissionHealthRunReceiptV1 {
  readonly schema: "niceeval.admission-health/v1";
  readonly occurrences: readonly AdmissionOccurrenceReceipt[];
  readonly slots: readonly AdmissionSlotReceipt[];
}

interface AdmissionOccurrenceReceipt {
  readonly identity: AdmissionOccurrenceIdentity;
  readonly isolation: AdmissionIsolation | null;
}

type AdmissionIsolation = {
  readonly reason: "unhealthy" | "probe-error" | "probe-timeout";
  readonly triggeringSlotId: string;
};

type AdmissionSlotReceipt =
  | {
      readonly state: "evaluated";
      readonly slot: AdmissionSlotRef;
      readonly occurrence: AdmissionOccurrenceIdentity;
      readonly health: "healthy" | "unhealthy";
      readonly code?: string;
    }
  | {
      readonly state: "errored";
      readonly slot: AdmissionSlotRef;
      readonly occurrence: AdmissionOccurrenceIdentity;
      readonly error: "probe-threw" | "probe-timeout";
    }
  | {
      readonly state: "not-run";
      readonly slot: AdmissionSlotRef;
      readonly occurrence: AdmissionOccurrenceIdentity;
      readonly reason:
        | "occurrence-isolated"
        | "budget-exhausted"
        | "early-exit"
        | "invocation-interrupted";
    };
```

`slots` 对需要准入健康的 fresh target slot 穷尽且不重复。历史 carry 不进入这份集合。一个
`evaluated` 或 `errored` slot 没有 `attemptId`；只有健康通过后才会 mint Attempt identity。

## 数据流

```text
ExecutionReusePlan.gaps
  -> 取得 fresh-slot 调度名额
  -> 找到 producer occurrence
  -> 健康探测一次
  -> healthy：mint Attempt identity -> agent.setup
  -> unhealthy / error / timeout：写 Run receipt，不建立 Attempt
```

Runner 在健康探测前固定 occurrence identity 与 slot ref。探测结果不能改变 identity，不能修改其他
occurrence，也不能要求 Scheduler 重排已经开始的工作。

## 隔离与失败

一个 `unhealthy`、`probe-threw` 或 `probe-timeout` 形成 occurrence isolation。Runner 停止该 occurrence
尚未开始的 slot，并为它们写 `not-run`。已经开始健康探测的 slot 继续如实收敛；它们不被取消后改写成
`not-run`。

健康探测不缓存。相同 identity 的两个 fresh slot 也必须分别执行一次探测，除非较早的探测已经触发隔离。
没有 TTL、success memo、failure memo、指数退避或自动重试层。

Provider 创建、Sandbox 准备、Agent ensure、健康探测、`agent.setup` 与 Eval 执行各有自己的失败 owner。
只有健康探测的三种失败写入 admission receipt；其余失败在所属 lifecycle 写入执行错误，不回填健康字段。

## 不变量

- health declaration 只属于 producer occurrence。
- 每条进入 health 阶段的 fresh slot 恰有一项回执。
- `healthy` 是建立 Attempt 的前置条件，不是 Assertion 或 Verdict。
- occurrence isolation 只影响同一 identity 的未开始 slot。
- receipt 可离线读取，且不含 secret、请求 body、响应 body 或异常堆栈。

## 身份与复用

Admission health 不参加 Attempt eligibility identity，也不使历史 Attempt 失去 carry 资格。它只约束本次需要
真实执行的 gap。因为它不产生 Attempt，历史 Run 也不能被拿来作为健康 cache。
