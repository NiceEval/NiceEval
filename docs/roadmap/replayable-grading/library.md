# 可重评分 Eval —— Library

## 推荐目录

一个 replayable Eval 使用四个 side-effect-free 模块：

```text
evals/mail/mail.refs.ts
evals/mail/mail.execution.ts
evals/mail/mail.grading.ts
evals/mail/mail.eval.ts
```

模块顶层只构造 definition、Ref schema 与 input descriptor。
文件读取放进受管 `inputs()`；Agent 与 Sandbox 操作发生在 execution callback，Fact 求值发生在 grading callback。

## Eval Ref contract

Ref schema 是定义期值，并同时生成 Execution 返回值与 Grading receiver 的 TypeScript 类型。

```ts
// mail.refs.ts
import { defineEvalRefs, sessionRef, turnRef } from "niceeval";

export const refs = defineEvalRefs({
  draft: turnRef(),
  sent: turnRef(),
  audit: sessionRef(),
  auditTurn: turnRef(),
});

export const gradingRefs = refs.pick({
  draft: true,
  sent: true,
  audit: true,
  auditTurn: true,
});
```

schema 只接受嵌套具名 record。
array、tuple、数字路径与动态 key 不进入 exported Ref；动态集合通过只读 traversal API 查询。

`refs.pick()` 产生 grading 真正需要的结构化子集。
旧 Execution 多产出一个 Ref 不会使 grader 失效；required path 缺失或 kind 改变才是不兼容。

```ts
type RefDescriptor = TurnRefDescriptor | SessionRefDescriptor;

declare function turnRef(): TurnRefDescriptor;
declare function sessionRef(): SessionRefDescriptor;

declare function defineEvalRefs<const S extends NamedRefSchema>(
  schema: S,
): EvalRefContract<S>;
```

## Execution 定义

```ts
// mail.execution.ts
import { defineEvalExecution } from "niceeval";
import { loadText } from "niceeval/loaders";
import { refs } from "./mail.refs.js";

export default defineEvalExecution({
  source: import.meta.url,
  refs,

  inputs: async () => ({
    prompt: await loadText(new URL("./task.md", import.meta.url)),
  }),

  async run(t, input) {
    const draft = await t.send(`${input.prompt}\n先拟稿，发送前询问我。`);
    const request = t.requireInputRequest({ action: "send_email" });
    const sent = await t.respond({ request, optionId: "approve" });

    const audit = t.newSession();
    const auditTurn = await audit.send("独立核对是否真的发送。");

    return { draft, sent, audit, auditTurn };
  },
});
```

`run()` 返回值必须和 produced Ref schema exact match。
成功路径缺 key、绑定错误 kind、重复绑定或引用别的 Attempt，都是 execution author error。

Execution context 保留现有 Eval 的驱动、即时读取、运行反馈与 Sandbox I/O 能力：

```ts
interface EvalExecutionDrive {
  send(input: SendInput): Promise<LiveTurn>;
  sendFile(path: string, text?: string): Promise<LiveTurn>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | RespondAnswer)[]): Promise<LiveTurn>;
  respondAll(optionId: string): Promise<LiveTurn>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
}

interface EvalExecutionSession extends EvalExecutionDrive {}

interface EvalExecutionContext extends EvalExecutionDrive {
  newSession(): EvalExecutionSession;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  log(message: string): void;
  skip(reason: string): never;
  readonly sandbox: EvalExecutionSandbox;
  readonly o11y: O11ySummary;
  readonly usage: Usage;
}

type EvalExecutionSandbox = SandboxOperations &
  SandboxTransferOperations & { readonly diff: DiffData };
```

上述成员的参数、HITL 消歧、Sandbox command 退出码、取消与反馈语义不重新定义，仍由已有 [Eval Context](../../feature/eval/library/context.md) 与 [Sandbox Operations](../../feature/sandbox/library/operations.md) 约束。
它不暴露 `check`、`assert`、`score`、Judge 或 Fact `require`。
普通分支、throw 与 skip 属于 execution，并进入 execution identity。

## Grading 定义

```ts
// mail.grading.ts
import { defineEvalGrading } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";
import { gradingRefs } from "./mail.refs.js";

export default defineEvalGrading({
  source: import.meta.url,
  refs: gradingRefs,

  inputs: async () => ({
    signoff: "此致",
  }),

  grade(g, ref, input) {
    g.assert(ref.draft.succeeded(), { key: "draft-succeeded" });
    g.assert(g.check(ref.draft.message, includes(input.signoff)), {
      key: "draft-signoff",
    });

    g.assert(
      ref.audit.through(ref.auditTurn).calledTool(toolMatch("mail_log")),
      { key: "audit-session-checked-log" },
    );

    g.assert(g.calledTool(toolMatch("send_email"), { count: 1 }), {
      key: "attempt-sent-once",
    });

    g.assert(
      g.check(
        { draft: ref.draft.message, sent: ref.sent.message },
        satisfies("发送结果与草稿一致", ({ draft, sent }) => sent.includes(draft)),
      ),
      { key: "cross-turn-consistency" },
    );

    g.assert(g.sandbox.during(ref.sent).fileChanged("outbox.json"), {
      key: "sent-turn-wrote-outbox",
    });
  },
});
```

Grading context 是受信任 TypeScript 中的 Record 只读 capability，不提供进程或操作系统级安全隔离。
它没有 `send`、`respond`、`newSession`、upload、command 或 live Sandbox。

```ts
interface EvalGradingContext extends ScopedFacts<"final"> {
  check: TestContext["check"];
  assert: KeyedAssert;
  assertIfCovered: KeyedAssertIfCovered;
  readonly sandbox: ReplaySandboxFacts;
  sessions(): readonly ReplaySession[];
  turns(): readonly ReplayTurn[];
  skip(reason: string): never;
}
```

`g.skip(reason)` 只结束本次 grading，不能改变已经封口的 execution。
它必须在任何 Fact use 前调用；空 reason 或登记部分结果后再调用是 author error。

Grading 没有 `require`。
已经发生的 Agent 控制流不能由离线评分倒推或中止。

本轮不定义 `ReplayJudge`，Grading context 也不暴露 `g.judge`。
现有 inline `t.judge` 的方法、句柄与模型调用保持不变；离线 Judge 属于后续独立批次。

## 组合入口

```ts
// mail.eval.ts
import { defineEval } from "niceeval";
import execution from "./mail.execution.js";
import grading from "./mail.grading.js";

export default defineEval({ execution, grading });
```

`defineScoreEval({ execution, grading })` 使用同一连接方式。
它的 Grading context 额外提供 key 必填的 `score()` 与 `finishScore()`。

## Scope 语义

| Receiver | 读取范围 | Phase |
|---|---|---|
| `ref.turn` | 一个 immutable Turn | `now` 等价证据，离线求值 |
| `ref.session` | 完整 sealed Agent Session | `final` |
| `ref.session.through(turn)` | 截止该 Turn 的明确前缀 | `final` |
| `g` | Execution graph 内全部 Session 与 Turn | `final` |
| `g.sandbox.during(turn)` | 该 Turn 的 send window diff | `final` |
| `g.sandbox` | Agent 归因的最终 Attempt diff | `final` |

live session Fact 在登记处冻结当时前缀。
replay 的 bare Session 是完整 sealed Session；需要相同前缀语义时必须显式使用 `through()`。
`session.through(turn)` 要求 Turn 属于该 Session；传入其它 Session 的 Ref 是 grading author error，不能扩大成 Attempt 级前缀。

## 受管 inputs

`inputs()` 在 Runner 已知 owner 后执行。
`loadText`、`loadYaml`、`loadJson`、`loadCriteria`、`loadPrivate` 与 `loadPrivateText` 因而分别进入 execution 或 grading identity。

replayable definition 的模块顶层调用 loader 是 `eval.input-owner-missing`。
非字面 dynamic import 与 CommonJS `require()` 无法形成可证明 closure，也在定义期拒绝。

普通 grading input 进入可发布 provenance closure。
现有 `loadPrivate(...patterns)` 仍只登记永不上传的路径清单，不返回文件内容。

需要在 grading callback 中读取隐藏 rubric 时使用受 grading owner 约束的新入口：

```ts
declare function loadPrivateText(path: string | URL): Promise<string>;
declare function appliesPrivateRubric(message: string, rubric: string): boolean;

export default defineEvalGrading({
  source: import.meta.url,
  refs: gradingRefs,
  inputs: async () => ({
    rubric: await loadPrivateText(new URL("./rubric.private.md", import.meta.url)),
  }),
  grade(g, ref, input) {
    g.assert(
      g.check(
        ref.draft.message,
        satisfies("符合私有 rubric", (message) =>
          appliesPrivateRubric(message, input.rubric),
        ),
      ),
      { key: "private-rubric" },
    );
  },
});
```

`loadPrivateText` 只在 grading `inputs()` 内合法。
它把 UTF-8 内容交给当次 GradingRun，只向 Record 写项目相对路径、digest、用途与读取状态，不把内容复制进可发布 graph。
