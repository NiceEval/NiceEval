// @concord-file
// @concord-implements docs/feature/judge/library.md
// @concord-implements docs/feature/judge/architecture.md
import {
  activeEvidenceRedactor,
  mapEvidenceText,
  redactJsonEvidence,
  type RedactEvidenceText,
} from "../sandbox/redaction.ts";
import { JudgeTimingSpan, type JudgeTimingOutcome } from "../judge/timing.ts";
import { agentJudgeIdentity } from "../runner/judge-identity.ts";
import { omitUndefined } from "../shared/omit-undefined.ts";
import { AGENT_JUDGE_ALGORITHM_REVISION } from "./agent-judge-revisions.ts";
import { resolvePiCodingAgent } from "../judge/pi-dependency.ts";
import { agentJudgeSystemPrompt, AGENT_JUDGE_TOOL_DESCRIPTION } from "./agent-judge.prompt.ts";
import { Effect, Schema } from "effect";
import type { AgentSession as PiAgent } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { piSandboxTools } from "../judge/pi-sandbox.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { SandboxCommandTimeoutError } from "../sandbox/deadline.ts";
import type { ResolvedJudgeConfig } from "./types.ts";
import type { JudgeUsageEntry } from "../o11y/judge-usage.ts";
import type { AssertionMaterial, MeasurementAssertionEvaluation, MeasurementAssertionRegistration } from "./api.ts";
import { agentJudgeQuestion, type NormalizedAgentJudge } from "./agent-judge-definition.ts";
import type { JudgeAnchor } from "./judge.ts";
import {
  AgentJudgeGradeSubmissionSchema,
  AgentJudgeBinarySubmissionSchema,
  agentJudgeMeasurement,
  agentJudgeDigest,
  readAgentJudgeAudit,
  type AgentJudgeAudit,
  type AgentJudgeFailure,
  type AgentJudgeSubmission,
  type AgentJudgeToolTrace,
  type AgentJudgeTrace,
} from "./agent-judge-audit.ts";
import { canonicalScoreMatchAuditJson as canonical } from "./score-match-audit.ts";
import { captureFullAssertionSnapshot, fullAssertionContentByteLength } from "./full-content.ts";
import { chunkUtf8, snapshotJudgeMaterial, projectJudgeMaterial } from "./judge-material-capture.ts";
import { interruptibleByCaller, isTransportFailure } from "./judge-transport.ts";
import { readJudgeImage, type JudgeMaterial } from "../judge/image.ts";
import { createManagedPiSession, type PiUsageReceipt } from "../judge/pi-runtime.ts";
import {
  managedPiCredential,
  piDefect,
  piUsageFailure,
  redactPiSessionEntries,
  safePiFailureMessage,
  type PiFailure,
} from "../judge/pi-failure.ts";
import { fitJudgeContext } from "./judge-context-budget.ts";

const utf8 = new TextEncoder();
const size = (value: string) => utf8.encode(value).byteLength;
const gradeParameters = Schema.toJsonSchemaDocument(AgentJudgeGradeSubmissionSchema).schema;
const binaryParameters = Schema.toJsonSchemaDocument(AgentJudgeBinarySubmissionSchema).schema;

type Submitted = NonNullable<AgentJudgeAudit["submission"]>;
type ReviewStep = { readonly message: string } & (
  | { readonly kind: "chat" }
  | { readonly kind: "judge"; readonly key: string }
  | { readonly kind: "grade"; readonly key: string; readonly anchors: readonly JudgeAnchor[] }
);
const stepPrompt = (step: ReviewStep) =>
  canonical({ kind: step.kind, message: step.message, ...(step.kind === "grade" ? { anchors: step.anchors } : {}) });
/** Attempt-local owner of a single real pi conversation and its shared evidence. */
export class AgentJudgeSession {
  private readonly snapshot: ReturnType<typeof snapshotJudgeMaterial>;
  private captured: string;
  private readonly openingMaterial: string;
  private readonly keys: string[] = [];
  private readonly steps: ReviewStep[] = [];
  private readonly cancelledKeys = new Set<string>();
  private readonly stepEntryIndex = new Map<string, number>();
  private imageBytesCharged = false;
  private currentKey: string | undefined;
  private currentTurns = 0;
  private currentFailure: AgentJudgeFailure | undefined;
  private currentStep = 0;
  entryIndex = -1;
  private usage: JudgeUsageEntry | undefined;
  private readonly submissions = new Map<string, Submitted>();
  private sessionEntries: unknown[] = [];
  private piSystemPrompt = "";
  private readonly tools: AgentJudgeToolTrace[] = [];
  private readonly compactions: AgentJudgeTrace["compactions"][number][] = [];
  private readonly results = new Map<string, AgentJudgeAudit["result"]>();
  private readonly definition: AgentJudgeTrace["definition"];
  private pi: ReturnType<typeof resolvePiCodingAgent> | undefined;
  private readonly subject: AssertionMaterial;
  private problem: AgentJudgeFailure | undefined;
  private started = false;
  private closed = false;
  private agent: PiAgent | undefined;
  private controller: AbortController | undefined;
  private running: Promise<void> | undefined;
  private ordinal = 0;
  private usageOrdinal = 0;
  private sealedTrace: AgentJudgeTrace | undefined;
  private cleanup: AgentJudgeTrace["cleanup"] = { state: "released", diagnostic: null };
  private timingSession: JudgeTimingSpan | undefined;
  private timingPrompt: JudgeTimingSpan | undefined;
  private readonly evidence = new Map<string, readonly AssertionMaterial[]>();

  readonly judge: NormalizedAgentJudge;
  private readonly sandbox: Sandbox;
  private readonly profile: ResolvedJudgeConfig | undefined;
  private readonly promptCache?: import("../judge/prompt-cache.ts").JudgePromptCache | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly usageForEntry: (index: number) => JudgeUsageEntry | undefined;
  private readonly redactEvidenceText: RedactEvidenceText | undefined;
  private readonly timing: import("../runner/timing.ts").TimingRecorder | undefined;
  constructor(
    judge: NormalizedAgentJudge,
    material: unknown,
    sandbox: Sandbox,
    profile: ResolvedJudgeConfig | undefined,
    signal: AbortSignal | undefined,
    usageForEntry: (index: number) => JudgeUsageEntry | undefined,
    timing?: import("../runner/timing.ts").TimingRecorder,
    promptCache?: import("../judge/prompt-cache.ts").JudgePromptCache,
    redactEvidenceText?: RedactEvidenceText,
  ) {
    this.judge = judge;
    this.redactEvidenceText = redactEvidenceText;
    this.sandbox = sandbox;
    this.profile = profile;
    this.promptCache = promptCache;
    this.signal = signal;
    this.usageForEntry = usageForEntry;
    this.timing = timing;
    this.snapshot = snapshotJudgeMaterial(material as JudgeMaterial, judge.maxMaterialBytes);
    this.captured = canonical(projectJudgeMaterial(this.snapshot.material, this.snapshot.imageByValue).json);
    this.openingMaterial = this.captured;
    this.subject = captureFullAssertionSnapshot({ content: chunkUtf8(this.captured) }, Infinity).material;
    const base = {
      version: "1",
      config: canonical({
        ...omitUndefined({ ...judge, instructions: judge.instructions === "" ? undefined : judge.instructions }),
        contextWindow:
          profile?.contextWindow ?? (profile === undefined ? undefined : builtinContextWindow(profile.model)) ?? null,
        algorithmRevision: AGENT_JUDGE_ALGORITHM_REVISION,
        content: agentJudgeIdentity().content,
        gradeParameters,
        binaryParameters,
      }),
      limits: omitUndefined({
        maxTurns: judge.maxTurns,
        timeoutMs: judge.timeoutMs,
        maxMaterialBytes: judge.maxMaterialBytes,
      }),
    };
    this.definition = { ...base, digest: agentJudgeDigest(canonical(base)) };
    if (judge.maxMaterialBytes !== undefined && size(this.captured) > judge.maxMaterialBytes)
      this.fail("unavailable", "agent-judge-material-budget", "Agent Judge material exceeds its byte budget");
  }

  private failPi(error: PiFailure): void {
    const message = safePiFailureMessage(error, this.profile, this.redactEvidenceText);
    switch (error.kind) {
      case "dependency":
        return this.fail("errored", "agent-judge-dependency-missing", message);
      case "provider":
        return this.fail("unavailable", "judge-provider-unresolved", message);
      case "credential":
        return this.fail("unavailable", "judge-key-unresolved", message);
      case "session-init":
      case "defect":
        return this.fail("errored", "agent-judge-defect", message);
      case "model-request":
        return this.fail("unavailable", "judge-call-failed", message);
      case "context-overflow":
        return this.fail("unavailable", "agent-judge-context-overflow", message);
      case "cancelled":
        // The owning Effect interruption/timeout decides the caller's terminal.
        return;
      default: {
        const exhaustive: never = error.kind;
        return exhaustive;
      }
    }
  }

  private images() {
    return this.snapshot.images.map(({ imageId, evidenceIndex, mediaType, byteLength, sha256, paths }) => ({
      imageId,
      evidenceIndex,
      mediaType,
      byteLength,
      sha256,
      paths,
    }));
  }
  private redactJson(value: string): string {
    return redactJsonEvidence(value, this.redactEvidenceText, canonical);
  }

  private redactPiEvidence<T>(value: T, redact?: RedactEvidenceText): T {
    return redactPiSessionEntries(
      mapEvidenceText(value, redact === undefined ? undefined : (text) => redactJsonEvidence(text, redact, canonical)),
      this.profile,
    );
  }

  private trace(redact?: RedactEvidenceText): AgentJudgeTrace {
    const { digest: _digest, ...definition } = this.definition;
    const safeDefinition = { ...definition, config: redactJsonEvidence(definition.config, redact, canonical) };
    return {
      cleanup: mapEvidenceText(this.cleanup, redact),
      definition: { ...safeDefinition, digest: agentJudgeDigest(canonical(safeDefinition)) },
      input: redactJsonEvidence(this.captured, redact, canonical),
      systemPrompt:
        redact?.(this.piSystemPrompt || this.systemPrompt()) ?? (this.piSystemPrompt || this.systemPrompt()),
      criteria: this.keys as [string, ...string[]],
      steps: this.steps.map((step) => ({
        kind: step.kind,
        message: redact?.(step.message) ?? step.message,
        key: step.kind === "chat" ? null : step.key,
        anchors: step.kind === "grade" ? mapEvidenceText(step.anchors, redact) : null,
      })),
      images: this.images(),
      session: this.redactPiEvidence(this.sessionEntries, redact),
      // Redact structured arguments before canonical encoding, just as pi history
      // redacts each string value. Redacting the encoded JSON can damage it.
      tools: this.tools.map((tool) => ({
        ...tool,
        callId: this.redactPiEvidence(tool.callId, redact),
        name: this.redactPiEvidence(tool.name, redact),
        arguments: canonical(this.redactPiEvidence(JSON.parse(tool.arguments), redact)),
        result: this.redactPiEvidence(tool.result, redact),
      })),
      compactions: this.compactions.map((compact) => ({
        ...compact,
        summary: this.redactPiEvidence(compact.summary, redact),
        failure:
          compact.failure === null
            ? null
            : {
                ...compact.failure,
                message: this.redactPiEvidence(compact.failure.message, redact),
              },
      })),
    };
  }
  private fail(state: AgentJudgeFailure["state"], code: string, message: string): void {
    this.problem ??= { state, code, message };
    this.abortAgent();
    this.controller?.abort();
  }

  chat(message: string): void {
    if (typeof message !== "string" || message.trim() === "")
      throw new TypeError("Agent Judge chat message must be non-empty");
    this.steps.push({ kind: "chat", message });
  }

  register(
    kind: "judge" | "grade",
    key: string,
    prompt: string,
    options: { readonly anchors: readonly JudgeAnchor[] } | undefined,
    entryIndex: number,
  ): MeasurementAssertionRegistration {
    const question = agentJudgeQuestion(kind, prompt, options);
    this.pi ??= resolvePiCodingAgent();
    if (this.keys.length === 0) {
      this.entryIndex = entryIndex;
      this.usage = this.usageForEntry(entryIndex);
    }
    this.keys.push(key);
    this.stepEntryIndex.set(key, entryIndex);
    this.steps.push(
      question.kind === "grade"
        ? { kind: question.kind, message: question.rubric, key, anchors: question.anchors }
        : { kind: question.kind, message: question.rubric, key },
    );
    const chargeImages = !this.imageBytesCharged;
    this.imageBytesCharged = true;
    return {
      criterion: { kind: "agent-judge-measurement", name: `agent-judge:${kind}`, scale: "unit-interval" },
      subject: this.subject,
      terminalSubject: () => {
        const redacted = this.redactJson(this.openingMaterial);
        return redacted === this.openingMaterial
          ? this.subject
          : captureFullAssertionSnapshot({ content: chunkUtf8(redacted) }, Infinity).material;
      },
      terminalCriterion: () => ({
        kind: "agent-judge-measurement",
        name: `agent-judge:${kind}`,
        scale: "unit-interval",
      }),
      // Only opening material participates in the Attempt's material ledger.
      // The full pi session is retained independently as chunked Content.
      retainedBytes: fullAssertionContentByteLength(this.subject) ?? 0,
      retainedImageBytes: chargeImages ? this.snapshot.images.reduce((sum, item) => sum + item.byteLength, 0) : 0,
      evidence: [],
      evaluate: () => this.evaluate(key),
      terminalEvidence: () => this.terminalEvidence(key),
      terminalDetail: () => undefined,
      terminalReceipt: () => undefined,
      coverage: { state: "complete" },
      limitations: [],
    };
  }

  cancelStep(key: string): void {
    if (this.started || this.closed || this.cancelledKeys.has(key)) return;
    this.cancelledKeys.add(key);
    const keyIndex = this.keys.indexOf(key);
    if (keyIndex >= 0) this.keys.splice(keyIndex, 1);
    const stepIndex = this.steps.findIndex((step) => step.kind !== "chat" && step.key === key);
    if (stepIndex >= 0) this.steps.splice(stepIndex, 1);
    this.stepEntryIndex.delete(key);
    const head = this.keys[0];
    if (head === undefined) {
      this.entryIndex = -1;
      this.usage = undefined;
    } else {
      const nextIndex = this.stepEntryIndex.get(head);
      if (nextIndex !== undefined) {
        this.entryIndex = nextIndex;
        this.usage = this.usageForEntry(nextIndex);
      }
    }
  }

  private terminalEvidence(key: string): readonly AssertionMaterial[] {
    if (this.cancelledKeys.has(key)) return [];
    const previous = this.evidence.get(key);
    if (previous !== undefined) return previous;
    const first = this.keys[0] === key;
    this.closed = true;
    this.sealedTrace ??= structuredClone(this.trace(activeEvidenceRedactor(this.redactEvidenceText)));
    const evidence: AssertionMaterial[] = [
      ...(first ? this.snapshot.images.map((image) => ({ kind: "judge-image" as const, image: image.image })) : []),
      ...(first ? [captureFullAssertionSnapshot(JSON.parse(canonical(this.sealedTrace)), Infinity).material] : []),
      captureFullAssertionSnapshot(this.envelope(key, this.sealedTrace, this.redactEvidenceText), Infinity).material,
    ];
    this.evidence.set(key, evidence);
    return evidence;
  }

  private envelope(key: string, trace: AgentJudgeTrace, redact?: RedactEvidenceText) {
    const payload: AgentJudgeAudit = {
      trace: { state: "reference", entryIndex: this.entryIndex, digest: agentJudgeDigest(canonical(trace)) },
      criterion: key,
      prompt: trace.steps.find((step) => step.kind !== "chat" && step.key === key)!.message,
      submission: this.redactPiEvidence(this.submissions.get(key) ?? null, redact),
      result: mapEvidenceText(this.results.get(key) ?? { state: "interrupted" }, redact),
    };
    const body = canonical(payload);
    const content = chunkUtf8(body);
    return {
      manifest: {
        byteLength: size(body),
        digest: agentJudgeDigest(body),
        chunkByteLengths: content.map(size),
      },
      content,
    };
  }

  private evaluate(key: string): Effect.Effect<MeasurementAssertionEvaluation> {
    if (this.cancelledKeys.has(key)) {
      return Effect.succeed({ state: "errored", detail: undefined, receipt: undefined });
    }
    const execute = Effect.suspend(() => {
      if (this.started) return Effect.void;
      this.started = true;
      return Effect.tryPromise({
        try: (signal) => {
          this.controller = new AbortController();
          const stop = () => {
            this.controller!.abort();
            this.abortAgent();
          };
          signal.addEventListener("abort", stop, { once: true });
          const span = JudgeTimingSpan.start(this.timing, "agent-judge.session");
          this.timingSession = span;
          this.running = this.run(this.controller.signal).finally(() => {
            span?.end(
              this.controller?.signal.aborted ? "cancelled" : this.problem === undefined ? "completed" : "failed",
            );
            signal.removeEventListener("abort", stop);
          });
          return this.running;
        },
        catch: piDefect,
      }).pipe(
        Effect.catchTag("PiFailure", (error) => Effect.sync(() => this.failPi(error))),
        Effect.timeoutOrElse({
          duration: this.judge.timeoutMs,
          orElse: () =>
            Effect.sync(() => this.fail("unavailable", "agent-judge-timeout", "Agent Judge review timed out")),
        }),
        Effect.ensuring(
          Effect.promise(async () => {
            this.abortAgent();
            this.controller?.abort();
            this.usage?.close();
            if (this.running !== undefined) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              const released = await Promise.race([
                this.running.then(
                  () => true,
                  () => true,
                ),
                new Promise<false>((resolve) => {
                  timer = setTimeout(() => resolve(false), 1000);
                }),
              ]);
              if (!released) {
                this.cleanup = {
                  state: "unconfirmed",
                  diagnostic:
                    "Judge tool cleanup could not confirm command-tree quiescence; this exclusive Sandbox must be retired",
                };
                for (const [index, tool] of this.tools.entries())
                  if (tool.result === null && tool.state === "completed")
                    this.tools[index] = { ...tool, state: "interrupted" };
              }
              if (timer !== undefined) clearTimeout(timer);
            }
            this.timingSession?.end(this.controller?.signal.aborted ? "cancelled" : "failed");
            this.closed = true;
          }),
        ),
      );
    });
    return interruptibleByCaller(execute, this.signal).pipe(
      Effect.andThen(
        Effect.sync((): MeasurementAssertionEvaluation => {
          const submitted = this.submissions.get(key);
          if (submitted !== undefined && this.cleanup.state === "released") {
            this.results.set(key, { state: "measured", value: agentJudgeMeasurement(submitted.value) });
            const trace = this.trace();
            const checked = readAgentJudgeAudit(
              this.envelope(key, trace),
              agentJudgeMeasurement(submitted.value),
              () => trace,
              this.snapshot.images.map((image) => ({
                mediaType: image.mediaType,
                bytes: readJudgeImage(image.image).body,
              })),
            );
            if (checked.state !== "available") {
              const failure = {
                state: "errored" as const,
                code: "agent-judge-audit-invalid",
                message: checked.state === "invalid" ? checked.message : "Unsupported Agent Judge terminal audit",
              };
              this.results.set(key, failure);
              return {
                state: "errored",
                detail: { code: failure.code, message: failure.message },
                receipt: undefined,
              };
            }
            return {
              state: "measured" as const,
              value: agentJudgeMeasurement(submitted.value),
              detail: {
                rationale: {
                  state: "available",
                  value: redactPiSessionEntries(submitted.value.rationale, this.profile),
                },
                evidence: { state: "available", value: redactPiSessionEntries(submitted.value.evidence, this.profile) },
              },
              receipt: undefined,
            };
          }
          const stored = this.results.get(key);
          const failure =
            stored !== undefined && (stored.state === "unavailable" || stored.state === "errored")
              ? stored
              : (this.problem ?? {
                  state: "unavailable" as const,
                  code: "agent-judge-no-submission",
                  message: "Review ended without submitting this criterion",
                });
          this.results.set(key, failure);
          return failure.state === "errored"
            ? {
                state: "errored" as const,
                detail: { code: failure.code, message: failure.message },
                receipt: undefined,
              }
            : {
                state: "unavailable" as const,
                reason: "source-unavailable" as const,
                detail: { failureDetail: failure.code, failureEvidence: failure.message },
                receipt: undefined,
              };
        }),
      ),
    );
  }

  private systemPrompt(): string {
    return agentJudgeSystemPrompt(this.judge.instructions);
  }

  private async run(signal: AbortSignal): Promise<void> {
    if (this.problem !== undefined) return;
    const profile = this.profile;
    if (profile === undefined) {
      this.fail("unavailable", "judge-provider-unresolved", "Judge Provider is not configured");
      return;
    }
    if (profile.protocol.kind !== "chat-completions") {
      this.fail("unavailable", "agent-judge-unsupported-provider", "Agent Judge requires a chat Provider");
      return;
    }
    if (this.snapshot.images.length > 0 && profile.supportsImages !== true) {
      this.fail("unavailable", "judge-capability-unavailable", "Judge Provider does not support image material");
      return;
    }
    const apiKey = managedPiCredential(profile);
    const parameters = () =>
      (this.steps[this.currentStep - 1]?.kind === "judge"
        ? binaryParameters
        : gradeParameters) as import("@earendil-works/pi-coding-agent").ToolDefinition["parameters"];
    const {
      session: agent,
      sessionManager,
      readUsageReceipts,
      startCompaction,
      finishCompaction,
      prompt,
    } = await createManagedPiSession({
      paths: this.pi!,
      profile,
      apiKey,
      promptCache: this.promptCache,
      systemPrompt: this.systemPrompt(),
      cwd: this.sandbox.workdir,
      tools: ["bash", "read", "write", "edit", "submit_evaluation"],
      timing: () => this.timingPrompt,
      customTools: (sdk) => [
        ...piSandboxTools(sdk, this.sandbox, {
          signal,
          timing: () => this.timingPrompt,
          admit: () => {
            if (
              this.closed ||
              this.problem !== undefined ||
              signal.aborted ||
              (this.currentKey !== undefined && this.submissions.has(this.currentKey))
            )
              throw new Error("Agent Judge is closed");
          },
          failed: (error) => {
            // A command deadline is a recoverable tool result. It says nothing
            // about whether the shared Sandbox can serve the next Judge command.
            if (!(error instanceof SandboxCommandTimeoutError) && isTransportFailure(error))
              this.fail("unavailable", "agent-judge-sandbox-unavailable", "Sandbox transport failed");
          },
        }),
        {
          name: "submit_evaluation",
          label: "Submit evaluation",
          description: AGENT_JUDGE_TOOL_DESCRIPTION,
          get parameters() {
            return parameters();
          },
          prepareArguments: (args) =>
            Schema.decodeUnknownSync(
              this.steps[this.currentStep - 1]?.kind === "judge"
                ? AgentJudgeBinarySubmissionSchema
                : AgentJudgeGradeSubmissionSchema,
              { onExcessProperty: "error" },
            )(args),
          execute: async (id, args) => this.submit(id, args, signal),
        },
      ],
    });
    const onAbort = () => this.abortAgent();
    let unsubscribe: (() => void) | undefined;
    let captureBeforeRelease: (() => void) | undefined;
    const failures: unknown[] = [];
    try {
      this.agent = agent;
      this.piSystemPrompt = agent.systemPrompt;
      const opening = fitJudgeContext({
        model: profile.model,
        contextWindow: profile.contextWindow,
        maxOutputTokens: profile.protocol.maxOutputTokens,
        material: this.snapshot.material,
        encodeRequest: (material) =>
          canonical({
            model: profile.model,
            messages: [
              { role: "system", content: agent.systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: canonical(projectJudgeMaterial(material, this.snapshot.imageByValue).json) },
                  ...this.snapshot.images.map((image) => ({
                    type: "image_url",
                    image_url: { url: `niceeval-image:${image.imageId}` },
                  })),
                ],
              },
              ...(this.steps[0] === undefined ? [] : [{ role: "user", content: stepPrompt(this.steps[0]) }]),
            ],
            tools: agent.agent.state.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          }),
      });
      if (opening.state === "unavailable") {
        this.fail("unavailable", opening.code, opening.message);
        return;
      }
      this.captured = canonical(projectJudgeMaterial(opening.material, this.snapshot.imageByValue).json);
      agent.agent.toolExecution = "sequential";
      const beforeToolCall = agent.agent.beforeToolCall;
      agent.agent.beforeToolCall = async (context, signal) =>
        this.currentKey !== undefined && this.submissions.has(this.currentKey)
          ? { block: true, reason: "Question already submitted", terminate: true }
          : beforeToolCall?.(context, signal);
      const afterToolCall = agent.agent.afterToolCall;
      agent.agent.afterToolCall = async (context, signal) => {
        const result = await afterToolCall?.(context, signal);
        return this.currentKey !== undefined &&
          (this.submissions.has(this.currentKey) || this.currentTurns >= this.judge.maxTurns)
          ? { ...result, terminate: true }
          : result;
      };
      sessionManager.appendMessage({
        role: "user",
        content: [
          { type: "text", text: this.captured },
          ...this.snapshot.images.map((image) => ({
            type: "image" as const,
            mimeType: image.mediaType,
            data: Buffer.from(readJudgeImage(image.image).body).toString("base64"),
          })),
        ],
        timestamp: Date.now(),
      });
      agent.refreshContext();
      const captureSession = () => {
        this.sessionEntries = JSON.parse(JSON.stringify(sessionManager.getEntries()));
        this.piSystemPrompt = agent.systemPrompt;
      };
      captureBeforeRelease = captureSession;
      signal.addEventListener("abort", onAbort, { once: true });
      let compaction: JudgeTimingSpan | undefined;
      unsubscribe = agent.subscribe((event) => {
        if (this.closed) return;
        if (event.type === "message_end") {
          if (event.message.role === "assistant") {
            this.ordinal += 1;
            this.currentTurns += 1;
            this.recordUsage(
              event.message.usage,
              readUsageReceipts(event.message.usage),
              event.message.stopReason === "error" || event.message.stopReason === "aborted" ? "failed" : "succeeded",
            );
          }
          captureSession();
        }
        if (
          event.type === "turn_end" &&
          this.currentKey !== undefined &&
          !this.submissions.has(this.currentKey) &&
          this.currentTurns >= this.judge.maxTurns &&
          event.message.role === "assistant" &&
          event.message.stopReason !== "error"
        ) {
          this.currentFailure = {
            state: "unavailable",
            code: "agent-judge-turn-budget",
            message: "Agent Judge model turn budget exhausted for this question",
          };
        }
        if (event.type === "tool_execution_start")
          this.tools.push({
            ordinal: this.tools.length + 1,
            step: this.currentStep,
            generation: this.ordinal,
            callId: event.toolCallId,
            name: event.toolName,
            arguments: canonical(event.args),
            validation: "not-checked",
            state: "not-started",
            result: null,
          });
        if (event.type === "tool_execution_end") {
          const isError = event.isError;
          const index = this.tools.findIndex((tool) => tool.callId === event.toolCallId);
          if (index < 0) return;
          const current = this.tools[index]!;
          const locked =
            this.currentKey !== undefined &&
            this.submissions.has(this.currentKey) &&
            current.name !== "submit_evaluation";
          function toolValidation() {
            if (current.validation !== "not-checked") return current.validation;
            return isError ? ("invalid" as const) : ("valid" as const);
          }
          function toolExecutionState() {
            if (signal.aborted) return "interrupted" as const;
            if (locked) return "not-started" as const;
            return isError ? ("failed" as const) : ("completed" as const);
          }
          this.tools[index] = {
            ...current,
            validation: toolValidation(),
            state: toolExecutionState(),
            result: event.result.content
              .filter((item: { type: string }) => item.type === "text")
              .map((item: { text: string }) => item.text)
              .join("\n"),
          };
        }
        if (event.type === "compaction_start") {
          startCompaction();
          compaction = this.timingPrompt?.child("agent-judge.compaction");
          this.compactions.push({
            trigger: Math.max(1, this.ordinal),
            tokensBefore: null,
            summary: null,
            failure: null,
          });
        }
        if (event.type === "compaction_end") {
          finishCompaction(event.result?.usage);
          compaction?.end(signal.aborted ? "cancelled" : event.result === undefined ? "failed" : "completed");
          compaction = undefined;
          const index = this.compactions.length - 1;
          const compact = this.compactions[index]!;
          if (event.result !== undefined) {
            this.compactions[index] = {
              ...compact,
              tokensBefore: event.result.tokensBefore,
              summary: event.result.summary,
            };
            if (event.result.usage !== undefined)
              this.recordUsage(event.result.usage, readUsageReceipts(event.result.usage), "succeeded");
          } else if (!event.willRetry) {
            this.compactions[index] = {
              ...compact,
              failure: {
                state: "unavailable",
                code: "agent-judge-context-overflow",
                message: event.errorMessage ?? "pi could not compact the context",
              },
            };
          }
          captureSession();
        }
      });
      const lastQuestion = this.steps.findLastIndex((step) => step.kind !== "chat");
      for (const [index, step] of this.steps.entries()) {
        if (index > lastQuestion || signal.aborted || this.closed || this.problem !== undefined) break;
        this.currentStep = index + 1;
        this.currentKey = step.kind === "chat" ? undefined : step.key;
        this.currentTurns = 0;
        this.currentFailure = undefined;
        const submitTool = agent.agent.state.tools.find((tool) => tool.name === "submit_evaluation");
        // pi retains this tool object in its registry and restores it before each prompt.
        if (submitTool !== undefined)
          submitTool.parameters = (
            step.kind === "judge" ? binaryParameters : gradeParameters
          ) as import("@earendil-works/pi-coding-agent").ToolDefinition["parameters"];
        this.timingPrompt = this.timingSession?.child(
          "agent-judge.prompt",
          step.kind === "chat" ? undefined : Number(step.key),
        );
        let timingOutcome: JudgeTimingOutcome = "completed";
        try {
          await prompt(stepPrompt(step), signal);
        } catch (cause) {
          timingOutcome = signal.aborted ? "cancelled" : "failed";
          this.failPi(piDefect(cause));
        } finally {
          compaction?.end(signal.aborted ? "cancelled" : "failed");
          compaction = undefined;
          this.timingPrompt?.end(timingOutcome);
          this.timingPrompt = undefined;
        }
        captureSession();
        if (step.kind !== "chat" && !this.submissions.has(step.key))
          this.results.set(
            step.key,
            this.problem ??
              this.currentFailure ?? {
                state: "unavailable",
                code: "agent-judge-no-submission",
                message: "Review ended without submitting this question",
              },
          );
      }
    } catch (error) {
      failures.push(error);
    } finally {
      // Snapshot failures must not skip listener removal or session disposal.
      try {
        captureBeforeRelease?.();
      } catch (error) {
        failures.push(error);
      }
      signal.removeEventListener("abort", onAbort);
      try {
        unsubscribe?.();
      } catch (error) {
        failures.push(error);
      }
      try {
        agent.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Agent Judge pi session failed during release");
    }
  }

  private abortAgent(): void {
    void this.agent?.abort().catch(() => undefined);
  }

  private recordUsage(
    usage: Usage,
    receipts: readonly PiUsageReceipt[] | undefined,
    status: "succeeded" | "failed",
  ): void {
    if (this.closed) return;
    const invalid = piUsageFailure(usage);
    if (invalid !== undefined) {
      this.failPi(invalid);
      return;
    }
    const profile = this.profile!;
    for (const receipt of receipts ?? [undefined]) {
      const ordinal = ++this.usageOrdinal;
      const call = this.usage?.begin({
        operation: "agent",
        logicalOrdinal: ordinal,
        transmissionOrdinal: 1,
        requestModel: profile.model,
        transportProvider: profile.provider,
      });
      if (this.usage !== undefined && call === undefined) {
        this.fail("unavailable", "judge-usage-capacity-exceeded", "Judge usage capacity exceeded");
        return;
      }
      if (receipt?.httpStatus !== undefined) call?.headers(receipt.httpStatus);
      if (!receipt?.body && status === "failed") call?.fail("response-unavailable");
      else call?.body(receipt?.body ?? "", status === "succeeded");
    }
  }

  private async submit(callId: string, args: unknown, signal: AbortSignal) {
    const index = this.tools.findIndex((tool) => tool.callId === callId);
    if (
      index < 0 ||
      this.closed ||
      this.problem !== undefined ||
      signal.aborted ||
      this.currentKey === undefined ||
      this.submissions.has(this.currentKey)
    )
      throw new Error("Criterion is not requested or already submitted");
    let value: AgentJudgeSubmission;
    try {
      value = Schema.decodeUnknownSync(
        this.steps[this.currentStep - 1]?.kind === "judge"
          ? AgentJudgeBinarySubmissionSchema
          : AgentJudgeGradeSubmissionSchema,
        { onExcessProperty: "error" },
      )(args);
    } catch {
      this.tools[index] = { ...this.tools[index]!, validation: "invalid", state: "failed" };
      throw new Error("Invalid submission; use the current question schema");
    }
    this.tools[index] = { ...this.tools[index]!, validation: "valid", state: "completed" };
    this.submissions.set(this.currentKey, { generation: this.ordinal, callId, value });
    return { content: [{ type: "text" as const, text: canonical({ accepted: this.currentKey }) }], details: {} };
  }
}
