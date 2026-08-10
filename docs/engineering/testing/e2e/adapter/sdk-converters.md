# Public SDK converter deterministic E2E owner

`adapter/sdk-converters` is the offline, model-free owner for eight public SDK
converter outcomes.

It is a standalone scenario repository.

The E2E runner installs the candidate NiceEval tarball. It injects
`@niceeval/testkit` because `harness.testkit` is true.

The scenario uses its own locked `pnpm-lock.yaml`.

Its `pr`, `main`, `nightly`, and `release` lanes require Node 22+. They use no
secret and no external network.

Each owner has one fixture, one Eval, one Experiment, and one test file. The
eight Vitest files retain default file parallelism.

Each test uses `withProjectCopy` for an isolated project, result, and JUnit
root.

It stages `.niceeval` and JUnit artifacts under invocation- and case-specific
paths.

Tests use only the installed candidate's public adapter and CLI surfaces. They
never inspect candidate source or a private result layout.

| Converter | Fixture | Eval / Experiment | Journey test |
| --- | --- | --- | --- |
| `turnFromAiSdk` | `fixtures/turn-from-ai-sdk.ts` | `turn-from-ai-sdk` | `test/turn-from-ai-sdk.test.ts` |
| `createClaudeSdkEventStream` | `fixtures/claude-sdk-stream.ts` | `claude-sdk-stream` | `test/claude-sdk-stream.test.ts` |
| `createCodexThreadEventStream` | `fixtures/codex-thread-stream.ts` | `codex-thread-stream` | `test/codex-thread-stream.test.ts` |
| `createPiAgentEventStream` | `fixtures/pi-agent-subscribe.ts` | `pi-agent-subscribe` | `test/pi-agent-subscribe.test.ts` |
| `createLangGraphEventStream` core | `fixtures/langgraph-core.ts` | `langgraph-core` | `test/langgraph-core.test.ts` |
| `createLangGraphEventStream` HITL | `fixtures/langgraph-hitl.ts` | `langgraph-hitl` | `test/langgraph-hitl.test.ts` |
| `turnFromChatCompletion` | `fixtures/openai-chat-completion.ts` | `openai-chat-completion` | `test/openai-chat-completion.test.ts` |
| `turnFromResponses` | `fixtures/openai-responses.ts` | `openai-responses` | `test/openai-responses.test.ts` |

Every Journey runs this command:

- `niceeval exp <experiment> --rerun all --json --junit ...`

It then reads the result through public commands:

- `niceeval show --exp`
- `niceeval show ... --history`
- `niceeval show @locator --execution`

The `// owner:` first line of each corresponding test points at its stable
anchor below.

<a id="turnfromaisdk-deterministic"></a>

## turnFromAiSdk deterministic

Provenance is exact `ai@7.0.30` and `zod@4.4.3`.

The fixture uses the AI SDK's own `MockLanguageModelV4` test/model seam.

It calls real `generateText`; it does not recreate a NiceEval-like result.

Its low-level `doGenerate` result is checked with
`satisfies Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>`.

The real SDK then supplies `steps`, `content`, and `responseMessages`.

It also supplies tool result and approval-response shapes to the public
converter.

The fixture emits a normal `inventory_lookup` call/result. It also emits an
`approval_tool` call that waits for approval.

It resumes once with the real SDK approval response. It resumes again with a
real SDK denial response. The Eval checks:

- native `toolCallId` pairing via completed `inventory_lookup` output;
- `waiting`, the `input.requested` action, then completed and rejected
  `approval_tool` branches; and
- the mutually exclusive usage buckets from SDK usage `13 = 7 + 4 + 2`
  (input, cache read, cache creation).

Removing or corrupting the normal call ID/result kills the completed
`inventory_lookup` assertion.

Removing the SDK approval part kills `parked()` and `requireInputRequest`.

Changing its response-message tool result kills the completed/rejected branch
assertions.

Removing either cache detail kills the exact usage assertions. Treating the
aggregate input as another bucket kills them too.

<a id="claude-sdk-stream-deterministic"></a>

## Claude SDK stream deterministic

Provenance is exact `@anthropic-ai/claude-agent-sdk@0.3.226`.

Its locked peers are `@anthropic-ai/sdk@0.116.0` and
`@modelcontextprotocol/sdk@1.30.0`.

The init frame uses `satisfies SDKSystemMessage`. The assistant frame uses
`satisfies SDKAssistantMessage`.

The user result frames use `satisfies SDKUserMessage` and `SDKMessage`. The
terminal result uses an exported `SDKResultSuccess` projection.

The raw protocol has native `Bash`, `Read`, and `Write` `tool_use` blocks.

It has their matching `tool_use_id` results, session ID, usage, and a terminal
result.

The consumer glue feeds every raw SDK frame unchanged to
`createClaudeSdkEventStream()`. It collects only returned events.

It calls `markRejected("claude-rejected-call")` before feeding that raw result.

The Eval proves a rejected `shell` result rather than a failed one.

The Eval proves canonical `shell`, `file_read`, and `file_write` identities.

It checks three output pairings, session capture, and terminal usage.

`driveFrameStream` is intentionally not imported or called in this owner.

No `input.requested` is attributed to `createClaudeSdkEventStream`.

Approval waiting is a consumer-level decision. It is not a converter claim on
this path.

Deleting or misnaming a native tool block kills its canonical-tool assertion.
Changing a `tool_use_id` kills the matching output assertion.

Removing the terminal usage/session field kills its exact assertion.

Removing `markRejected` or its matching raw result kills the rejected-shell
assertion.

<a id="codex-thread-stream-deterministic"></a>

## Codex thread stream deterministic

Provenance is exact `@openai/codex-sdk@0.147.0`.

The completed fixture is `satisfies readonly ThreadEvent[]`.

The terminal-failed fixture uses the same checked upstream union. Their raw
`ThreadEvent` values are checked against the locked upstream SDK.

The consumer makes no `StreamEvent` mapping. It makes no usage, status, or
canonical-tool mapping either.

It feeds raw events to `createCodexThreadEventStream()`. It returns the
converter's collected events, usage, thread ID, and failure state.

The completed session proves native `command_execution` becomes canonical
`shell`.

It preserves the call ID across start/result. It maps `file_change` to
canonical `file_edit`.

It checks `input_tokens - cached_input_tokens` and cache read.

It also checks output, reasoning, and captured thread ID. A second session
feeds a terminal `turn.failed`.

That session proves the converter exposes a failure error and failed status.

It also proves terminal command pairing, usage, and a distinct thread ID.

Deleting or changing a command/file ID or its terminal counterpart kills the
paired `shell`/`file_edit` assertions.

Changing `command_execution` or `file_change` kills the canonical identities.
Corrupting usage or thread ID kills exact readback.

Removing `turn.failed` kills the failed-status and terminal-error assertions.

<a id="pi-agent-subscribe-deterministic"></a>

## Pi Agent subscribe deterministic

Provenance is exact `@earendil-works/pi-agent-core@0.82.1` and
`@earendil-works/pi-ai@0.82.1`.

The fixture constructs the real `Agent`. It subscribes before `prompt()`.

Each exact callback object enters `createPiAgentEventStream()` directly. The
fixture waits for idle and unsubscribes in `finally`.

Its deterministic provider seam returns pi-ai's real
`AssistantMessageEventStream`. It never constructs an `AgentEvent` array.

The successful run proves native tool start/result pairing and assistant text.
It also proves session capture and mutually exclusive usage.

A second run proves the converter exposes the upstream terminal error and
failed status.

Removing `agent.subscribe()`, changing the native call ID, or omitting the
terminal error kills a distinct Eval assertion.

<a id="langgraph-core-deterministic"></a>

## LangGraph core deterministic

Provenance is exact `@langchain/langgraph@1.4.8`,
`@langchain/core@1.2.5`, and `@langchain/protocol@0.0.18`.

A real `StateGraph` runs through `streamEvents(..., { version: "v3" })`.
Every raw runtime `ProtocolEvent` enters a fresh converter unchanged.

The owner checks that the runtime emits lifecycle events and completes.

A separate `Event[]` owns the fine-grained messages and tools channels. Its
elements are checked by `@langchain/protocol`.

The no-model graph does not naturally emit those channels. The test never
claims that its runtime emitted the separate deterministic facts.

The Eval proves message and tool input/output pairing. It also proves lifecycle
status and mutually exclusive usage buckets.

Methods without a standard mapping emit no standard event. Their sequence still
advances.

A namespaced `values` frame proves that this path infers no ghost subagent.

<a id="langgraph-hitl-deterministic"></a>

## LangGraph HITL deterministic

The owner runs a real interrupting graph with `MemorySaver`. It resumes the
graph through the official `Command` API and the same thread ID.

Each upstream run gets a new converter. Sequence, lifecycle, usage, and dedupe
state are run-local.

Canonical input, tool, and lifecycle frames are separate typed
`@langchain/protocol` values. The runtime receipt proves the real
interrupt/resume boundary.

The owner does not imply that the runtime emitted every canonical Agent
Protocol method.

The first Turn is waiting with a pending tool and input request. Approved and
rejected sessions resume the same call ID.

Rejection calls `markRejected()` before the raw `tool-error`. It produces no
tool output and never duplicates the start event.

<a id="openai-chat-completion-deterministic"></a>

## OpenAI Chat Completion deterministic

Provenance is exact `openai@6.49.0`.

The official client uses an injected deterministic `fetch`. It performs
exactly one `chat.completions.create()` call.

The complete returned value enters `turnFromChatCompletion()` directly. The
fixture uses no cast or field projection.

The response covers current `function` and `custom` tool-call variants. It
also covers assistant text and all supported usage buckets.

Unknown future tool-call variants are ignored safely. Deprecated message-level
`function_call` is not part of the contract.

<a id="openai-responses-deterministic"></a>

## OpenAI Responses deterministic

The same official client makes exactly one `responses.create()` call. It uses
an injected deterministic `fetch`.

Its complete returned `Response` enters `turnFromResponses()` directly. The
fixture uses no cast or projection.

The Eval proves `output_text`, `function_call`, and call ID/input preservation.
It also proves mutually exclusive usage.

Unknown output item types are ignored safely. Responses evidence therefore
remains partial instead of making an unsupported exhaustive-negative claim.

## Local verification

Run the scenario through the root runner. It packs and installs the candidate
tarball rather than resolving the working tree directly:

```sh
pnpm e2e --repo adapter/sdk-converters
```

Do not run the leaf's `typecheck` script from the checked-in source directory.

That source intentionally declares neither the private Testkit dependency nor a
working-tree NiceEval link.

The script is only valid inside an isolated copy. The root runner must first
inject the candidate tarball and checkout-local Testkit and complete installation.

This owner follows the repository's current reliability handoff rules.

The command establishes deterministic behavior. It does not claim the suite is
already mature.
