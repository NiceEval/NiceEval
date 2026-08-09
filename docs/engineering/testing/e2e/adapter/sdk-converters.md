# Public SDK converter deterministic E2E owner

`adapter/sdk-converters` is the offline, model-free owner for three public SDK
converters. It does not cover Pi or LangGraph.

It is a standalone scenario repository.

The E2E runner installs the candidate NiceEval tarball. It injects
`@niceeval/testkit` because `harness.testkit` is true.

The scenario uses its own locked `pnpm-lock.yaml`.

Its `pr`, `main`, `nightly`, and `release` lanes require Node 22+. They use no
secret and no external network.

Each owner has one fixture, one Eval, one Experiment, and one test file. The
three Vitest files retain default file parallelism.

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
