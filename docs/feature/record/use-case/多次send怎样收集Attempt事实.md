---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 多次 send 怎样收集 Attempt 事实

业务希望每次 send 都保存一个小型 metric 时，用 Attempt Record collection 声明 item Schema，再由 Host/capture
producer 在同一个 `AttemptWriteSession` 上 append。契约单源仍在
[Attempt Record collection](../library.md#attempt-record-collection) 与
[Writer 状态机](../architecture.md#writer-与发布状态机)。

这不是普通 Eval 作者 API。Eval `TestContext`、Adapter 与 Plugin 没有 `AttemptWriteSession`；下面代码只放在组合
Record Host、创建 Run / Attempt 并拥有 capture 生命周期的 producer 中。

## 声明业务字段

```ts
import { Effect, Schema } from "effect";
import {
  defineAttemptRecordCollection,
  makeRecordHost,
} from "niceeval/record";

const turnMetrics = defineAttemptRecordCollection({
  family: "acme.turn-metrics",
  item: Schema.Struct({
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    latencyMs: Schema.Number,
    outputTokens: Schema.Number,
  }),
});

const host = makeRecordHost({ records: [turnMetrics] });
```

“多写一个字段”就是先把字段加入 `item` Schema，再在每次 append 中提供它。这里的 `outputTokens` 与其它 item 字段
一起在 append 执行时 encode；Schema 不接受的值不会进入 collection。若 `acme.turn-metrics` 已经持久发布，改变 item
字段就是该 family 的 persistence schema 演进，必须进入底层 revision / migration，不把每次 append 当作 version。

item 必须是 context-free plain data。它不能含 content/reference declaration、session builder 或 Stream。
需要这些能力，或需要业务 validate、排序/去重与其它 partial gap 时，改用 `defineAttemptRecord()`、领域 collector 和
最终一次 `record.write()`。

## 跨 send 与 Agent Session append

下面假定 `root`、包含同一 `root` 的 `runRequest`、`slotId` 与 `completedAt` 已由 Host 编排层构造为公开 API
接受的 typed input：

```ts
const result = yield* Effect.scoped(Effect.gen(function* () {
  const run = yield* host.current.createRun(runRequest);
  const attempt = yield* run.createAttempt({ slotId });

  // 可省略；保留它表示即使零次 send 也要发布 complete-empty。
  yield* attempt.record.start(turnMetrics);

  const first = {
    sessionIndex: 0,
    turnIndex: 0,
    latencyMs: 12,
    outputTokens: 30,
  };
  const firstReceipt = yield* attempt.record.append(turnMetrics(first));

  // append 已保存 canonical snapshot；这里的修改不会回写第一项。
  first.latencyMs = 999;

  yield* attempt.record.append(turnMetrics({
    sessionIndex: 0,
    turnIndex: 1,
    latencyMs: 18,
    outputTokens: 42,
  }));

  // t.newSession() 只创建新的 Agent Session；owner 仍是同一个 Attempt。
  yield* attempt.record.append(turnMetrics({
    sessionIndex: 1,
    turnIndex: 0,
    latencyMs: 21,
    outputTokens: 36,
  }));

  // producer 在这里先 join 自己启动的全部 capture task。
  yield* attempt.complete("completed");
  yield* run.seal({ completedAt });

  const reader = yield* host.current.openRead({ root });
  const selection = yield* reader.selectRuns({ runIds: [run.runId] });
  const sealedRun = yield* reader.readRun(selection.runRefs[0]!);
  if (sealedRun.state !== "available") return sealedRun;

  const attemptRef = sealedRun.value.members[0]?.attempt;
  if (attemptRef === null || attemptRef === undefined) {
    return yield* Effect.die("Attempt reference missing after seal");
  }
  const sealedAttempt = yield* reader.readAttempt(attemptRef);
  if (sealedAttempt.state !== "available") return sealedAttempt;

  const collection = yield* reader.read(sealedAttempt.value.owner, turnMetrics);
  return { firstReceipt, collection };
}));
```

正常结果中，`firstReceipt` 是 `{ state: "retained" }`。读回的 collection 为 `available` 与 `complete`，三项保持
Host 线性化顺序；第一项的 `latencyMs` 仍是 snapshot 时的 `12`，不是随后改写的 `999`。

真实 Host 在每次 `send` settle 后的 capture callback 中执行对应 append。`t.newSession()` 不把数据分成另一份
Attachment；`sessionIndex` / `turnIndex` 只是业务显式声明的排序事实。

Host mutex 给所有 append 一个总序，但不自动按这些字段排序，也不去重。若并发 callback 的业务顺序重要，就在 item
中写 `sessionIndex`、`turnIndex` 或稳定 ID，并由读侧按业务规则解释。复用同一个 append command 会在每次执行时产生
一项，不会因对象或 command 相同而去重。

## Activation、cap 与 outcome

| 情况 | 公开结果 |
|---|---|
| 没有 start，也没有 append | `not-recorded` |
| 显式 start，零项后正常 complete | `complete` + empty `items` |
| 首个 append，没有 start | 隐式激活并保留 item |
| item 在固定 cap 内 | `{ state: "retained" }` |
| item 超过固定 cap | `{ state: "omitted", reason: "collection-cap-reached" }` |
| cap 后封口 | 保留安全 prefix；`partial` + `{ code: "collection-cap-reached", omittedAtLeast }` |
| 已激活 capture 被中断 | 保留安全 prefix；`partial` + `{ code: "capture-interrupted", stage: "attempt-finalizer" }` |
| `completed` / `errored` / `cancelled` 且 capture 已 join | `complete` |

Host composition、reader、reference declaration 与 reference creation 都不激活 collection。collection definition 可以
作为整份 logical value 的 rich Record reference target，但 item 自己不能携带 reference declaration。

## 一份 Attachment，不是 append 日志

Attempt complete 时，Host 把所有 retained item 与 collection 状态封成一个 logical value。物理上只有一份 revision
`1` Attachment；没有每次 append 的 revision、event file 或 Run collection。Run seal 成功后，reader 才能看到这份
immutable value。
