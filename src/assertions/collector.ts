// Fact/use collector. Producers only create evidence; uses decide verdicts and scores.

import type { AssertionEvaluationContext, SourceLoc } from "../types.ts";
import { captureLoc } from "../source-loc.ts";
import { EvalRequirementFailed } from "../context/control-flow.ts";
import type {
  AttemptFactIssue,
  ErrorAttemptIssue,
  BooleanFact,
  EvaluationFactError,
  EvaluationFactResult,
  FactPhase,
  FactUseOptions,
  ScoreFact,
  ScoreFactAttemptOutcome,
  ScoreFactUseResult,
  ScoreThresholdOptions,
  UsageEvidenceFact,
  VerdictFactUseResult,
} from "./types.ts";

export type EvidenceChannel = "diff";

export interface EvidenceRequirementSnapshot {
  readonly diff: {
    readonly required: boolean;
    readonly optionalConsumers: number;
    readonly requiredConsumers: number;
    readonly directReads: number;
  };
}

/** Progress for the known, reachable serial Judge batch. */
export interface JudgeProgress {
  readonly index: number;
  readonly total: number;
  readonly check: string;
}
type FactRuntimeOutcome =
  | {
      readonly outcome: "passed" | "failed";
      /** Boolean Fact witness returned by `require()` after a successful evaluation. */
      readonly value?: unknown;
      readonly expected?: string;
      readonly received?: string;
      readonly evidence?: string;
      readonly explanation?: string;
    }
  | {
      readonly outcome: "scored";
      readonly normalizedScore: number;
      readonly expected?: string;
      readonly received?: string;
      readonly evidence?: string;
      readonly explanation?: string;
    }
  | {
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly evidence?: string;
      /**
       * Core-only provenance: this absence was declared by the Agent at
       * creation time, rather than caused by a later truncation or transport
       * downgrade. `assertIfCovered()` is the sole consumer allowed to turn
       * precisely this case into notApplicable.
       */
      readonly usageUnavailableAtCreation?: true;
    }
  | { readonly outcome: "errored"; readonly error: EvaluationFactError };

export type BooleanFactEvaluation = Extract<FactRuntimeOutcome, { readonly outcome: "passed" | "failed" | "unavailable" | "errored" }>;
export type ScoreFactEvaluation = Extract<FactRuntimeOutcome, { readonly outcome: "scored" | "unavailable" | "errored" }>;

export interface FactDefinition<R, P extends FactPhase> {
  readonly name: string;
  readonly phase: P;
  readonly value: R;
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<BooleanFactEvaluation> | BooleanFactEvaluation;
  readonly dependencyFacts?: readonly (BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>)[];
  readonly usageEvidence?: boolean;
  readonly evidence?: EvidenceChannel;
}

export interface ScoreFactDefinition<P extends FactPhase> {
  readonly name: string;
  readonly phase: P;
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<ScoreFactEvaluation> | ScoreFactEvaluation;
  readonly dependencyFacts?: readonly (BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>)[];
  readonly evidence?: EvidenceChannel;
  /** Runtime-only evaluator metadata used for serial Judge activity reporting. */
  readonly judge?: { readonly check: string };
}

interface FactNode {
  readonly fact: object;
  readonly id: string;
  readonly name: string;
  readonly kind: "boolean" | "score";
  readonly phase: FactPhase;
  value: unknown;
  readonly producerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
  readonly groupPath?: readonly string[];
  readonly dependencies: readonly FactNode[];
  readonly usageEvidence: boolean;
  /** Set only from the structured evaluator provenance above, never a reason string. */
  usageUnavailableAtCreation: boolean;
  readonly evidence?: EvidenceChannel;
  readonly judge?: { readonly check: string };
  readonly evaluate: (context: AssertionEvaluationContext) => Promise<FactRuntimeOutcome>;
  result: EvaluationFactResult | undefined;
  evaluating: Promise<EvaluationFactResult> | undefined;
}

interface VerdictUseNode {
  readonly kind: "verdict";
  readonly node: FactNode;
  readonly method: "assert" | "require" | "assertIfCovered";
  readonly label?: string;
  readonly key: string | undefined;
  readonly atLeast?: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

interface FactScoreUseNode {
  readonly kind: "score";
  readonly input: "fact";
  readonly node: FactNode;
  readonly label: string;
  readonly key: string | undefined;
  readonly max: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

interface DirectScoreUseNode {
  readonly kind: "score";
  readonly input: "direct";
  readonly label: string;
  readonly key: string | undefined;
  readonly earned: number;
  readonly consumerLoc: SourceLoc | undefined;
  readonly sourceOrder: number;
}

type FactUseNode = VerdictUseNode | FactScoreUseNode | DirectScoreUseNode;

interface Requirement<R> {
  readonly use: VerdictUseNode;
  readonly node: FactNode;
  state: "created" | "observed-pending" | "settled";
  /** The Fact's own settlement; `.then()` chains are tracked independently. */
  promise: Promise<R> | undefined;
  baseSettled: boolean;
  pendingContinuations: number;
}

interface FactCollectorOptions {
  readonly evaluationKind?: "pass" | "score";
  readonly liveContext: () => Promise<AssertionEvaluationContext>;
  readonly nextSourceOrder?: () => number;
}

export interface FactFinalizeResult {
  readonly factResults: readonly EvaluationFactResult[];
  readonly factUses: readonly (VerdictFactUseResult | ScoreFactUseResult)[];
  readonly pass: import("./types.ts").PassFactAttemptOutcome;
  readonly score: ScoreFactAttemptOutcome;
}

interface FactFinalizeOptions {
  readonly onJudgeProgress?: (progress: JudgeProgress) => void;
  /** Runner-originated errors that occurred after the graph was registered. */
  readonly externalErrors?: readonly ErrorAttemptIssue[];
}

/**
 * The one-owner Attempt graph for ordinary Facts.  Facts are memoized at the
 * node, not at each use; the same Fact can therefore back one verdict and one
 * score use without a second evaluator invocation.
 */
export class FactCollector {
  private readonly nodes: FactNode[] = [];
  private readonly nodeByFact = new WeakMap<object, FactNode>();
  private readonly uses: FactUseNode[] = [];
  private readonly verdictUseByFact = new WeakMap<object, VerdictUseNode>();
  private readonly scoreUseByFact = new WeakMap<object, FactScoreUseNode>();
  private readonly requirementList: Requirement<unknown>[] = [];
  private readonly groupStack: string[] = [];
  private readonly keys = new Set<string>();
  private readonly unavailableEvidence = new Map<EvidenceChannel, string>();
  /** One attempt owns one Judge lane, including immediately required Facts. */
  private judgeEvaluationTail: Promise<void> = Promise.resolve();
  private readonly liveContext: () => Promise<AssertionEvaluationContext>;
  private readonly evaluationKind: "pass" | "score";
  private readonly nextSourceOrder: () => number;
  private localSourceOrder = 0;
  private terminal:
    | { readonly kind: "control"; readonly signal: EvalRequirementFailed }
    | { readonly kind: "error"; readonly reason: string }
    | { readonly kind: "skipped"; readonly reason: string }
    | { readonly kind: "finished" }
    | undefined;
  /**
   * Runner errors seal the complete graph synchronously.  An evaluator may
   * still resolve after that point, but it must never rewrite the Attempt
   * Fact result graph that was exposed to the Runner.
   */
  private runnerErrorFinalization: FactFinalizeResult | undefined;
  private diffConsumers = 0;

  constructor(options: FactCollectorOptions) {
    this.liveContext = options.liveContext;
    this.evaluationKind = options.evaluationKind ?? "pass";
    this.nextSourceOrder = options.nextSourceOrder ?? (() => ++this.localSourceOrder);
  }

  /** Compatibility shape consumed by the current Runner's diff export phase. */
  evidenceRequirementSnapshot(): EvidenceRequirementSnapshot {
    return {
      diff: {
        required: this.diffConsumers > 0,
        optionalConsumers: 0,
        requiredConsumers: this.diffConsumers,
        directReads: 0,
      },
    };
  }

  evidenceRequirements(): EvidenceRequirementSnapshot {
    return this.evidenceRequirementSnapshot();
  }

  markEvidenceUnavailable(channel: EvidenceChannel, reason: string): void {
    this.unavailableEvidence.set(channel, reason);
  }

  requireDiffEvidence(): void {
    this.diffConsumers += 1;
  }

  createBooleanFact<R, P extends FactPhase>(definition: FactDefinition<R, P>): BooleanFact<R, P> {
    this.assertCanRegister();
    const dependencies = (definition.dependencyFacts ?? []).map((fact) => this.nodeFor(fact));
    const fact = Object.freeze({ kind: "boolean" as const, phase: definition.phase }) as BooleanFact<R, P>;
    const node: FactNode = {
      fact,
      id: `fact-${this.nodes.length + 1}`,
      name: definition.name,
      kind: "boolean",
      phase: definition.phase,
      value: definition.value,
      producerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      dependencies,
      usageEvidence: definition.usageEvidence === true,
      usageUnavailableAtCreation: false,
      ...(definition.evidence === undefined ? {} : { evidence: definition.evidence }),
      evaluate: async (context) => definition.evaluate(context),
      result: undefined,
      evaluating: undefined,
    };
    this.nodes.push(node);
    this.nodeByFact.set(fact, node);
    return fact;
  }

  createScoreFact<P extends FactPhase>(definition: ScoreFactDefinition<P>): ScoreFact<P> {
    this.assertCanRegister();
    const dependencies = (definition.dependencyFacts ?? []).map((fact) => this.nodeFor(fact));
    const fact = Object.freeze({ kind: "score" as const, phase: definition.phase }) as ScoreFact<P>;
    const node: FactNode = {
      fact,
      id: `fact-${this.nodes.length + 1}`,
      name: definition.name,
      kind: "score",
      phase: definition.phase,
      value: undefined,
      producerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
      ...(this.groupStack.length > 0 ? { groupPath: this.groupStack.slice() } : {}),
      dependencies,
      usageEvidence: false,
      usageUnavailableAtCreation: false,
      ...(definition.evidence === undefined ? {} : { evidence: definition.evidence }),
      ...(definition.judge === undefined ? {} : { judge: definition.judge }),
      evaluate: async (context) => definition.evaluate(context),
      result: undefined,
      evaluating: undefined,
    };
    this.nodes.push(node);
    this.nodeByFact.set(fact, node);
    return fact;
  }

  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options?: FactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: ScoreThresholdOptions): void;
  assert(fact: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>, options?: FactUseOptions | ScoreThresholdOptions): void {
    this.assertCanRegister();
    const node = this.nodeFor(fact);
    const atLeast = node.kind === "score" ? this.thresholdOptions(options, "assert") : undefined;
    this.addVerdictUse(node, "assert", options, atLeast);
  }

  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options?: FactUseOptions): void {
    this.assertCanRegister();
    const node = this.nodeFor(fact);
    if (!node.usageEvidence) throw new TypeError("assertIfCovered() accepts only a core usage evidence Fact");
    this.addVerdictUse(node, "assertIfCovered", options, undefined);
  }

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require(fact: ScoreFact<"now">, options: ScoreThresholdOptions): Promise<number>;
  require<R>(fact: BooleanFact<R, "now"> | ScoreFact<"now">, options?: FactUseOptions | ScoreThresholdOptions): Promise<R | number> {
    // `require(value, match)` creates a Fact immediately before it gets here.
    // Register this use first, then check graph reachability atomically.
    this.beforeManagedBoundary("require", { checkDangling: false });
    const node = this.nodeFor(fact);
    if (node.phase !== "now") throw new TypeError("require() accepts only phase: now Facts");
    const atLeast = node.kind === "score" ? this.thresholdOptions(options, "require") : undefined;
    const use = this.addVerdictUse(node, "require", options, atLeast);
    this.assertNoDanglingFacts();
    const requirement: Requirement<R | number> = {
      use,
      node,
      state: "created",
      promise: undefined,
      baseSettled: false,
      pendingContinuations: 0,
    };
    this.requirementList.push(requirement);
    // `require` begins evaluation at this managed boundary. The returned
    // thenable still records whether the author actually observed the result.
    requirement.promise = this.settleRequirement(requirement);
    // An unobserved requirement is reported at the next managed boundary;
    // suppress the host-level unhandled-rejection side channel meanwhile.
    requirement.promise.catch(() => {});
    return this.managedRequirement(requirement);
  }

  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key?: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key?: string; readonly earned: number }): void;
  score(
    label: string,
    factOrDirect: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase> | { readonly key?: string; readonly earned: number },
    options?: { readonly key?: string; readonly max: number },
  ): void {
    this.assertCanRegister();
    if (this.evaluationKind !== "score") throw new Error("score() is available only in defineScoreEval");
    this.assertLabel(label, "score()");
    if (this.isFact(factOrDirect)) {
      if (options === undefined) throw new TypeError("score(label, fact, { max }) requires max");
      if (!Number.isFinite(options.max) || options.max <= 0) {
        throw new TypeError("score() max must be a positive finite number");
      }
      const node = this.nodeFor(factOrDirect);
      if (this.scoreUseByFact.has(node.fact)) throw new Error(`Fact ${node.name} already has a score use`);
      const key = this.validateKey(options.key);
      const use: FactScoreUseNode = {
        kind: "score",
        input: "fact",
        node,
        label,
        key,
        max: options.max,
        consumerLoc: captureLoc(),
        sourceOrder: this.nextSourceOrder(),
      };
      this.scoreUseByFact.set(node.fact, use);
      this.uses.push(use);
      return;
    }
    if (options !== undefined || !("earned" in factOrDirect)) {
      throw new TypeError("score(label, direct) accepts only { earned, key? }");
    }
    if (!Number.isFinite(factOrDirect.earned) || factOrDirect.earned < 0) {
      throw new TypeError("score() earned must be a non-negative finite number");
    }
    this.uses.push({
      kind: "score",
      input: "direct",
      label,
      key: this.validateKey(factOrDirect.key),
      earned: factOrDirect.earned,
      consumerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
    });
  }

  async withGroup<T>(title: string, fn: () => Promise<T> | T): Promise<T> {
    this.assertCanRegister();
    this.assertLabel(title, "group()");
    this.groupStack.push(title);
    try {
      return await fn();
    } finally {
      this.groupStack.pop();
    }
  }

  /** Called by t.send/sandbox/normal return before entering another managed edge. */
  beforeManagedBoundary(boundary: string, options: { readonly checkDangling?: boolean } = {}): void {
    if (this.terminal?.kind === "control") throw this.terminal.signal;
    if (this.terminal?.kind === "error" || this.terminal?.kind === "skipped") {
      throw new Error(`Cannot enter ${boundary}; the Fact collector is closed`);
    }
    if (this.terminal?.kind === "finished") {
      throw new Error(`Cannot enter ${boundary}; the test already returned and closed the collector`);
    }
    for (const requirement of this.requirementList) {
      if (requirement.state === "created") {
        throw new Error("requirement was created but never observed before the next managed boundary");
      }
      if (requirement.state === "observed-pending") {
        throw new Error("requirement is still pending before the next managed boundary");
      }
    }
    if (options.checkDangling !== false) this.assertNoDanglingFacts();
  }

  completePass(): void {
    this.completeNormalReturn(() => {
      if (!this.uses.some((use) => use.kind === "verdict")) {
        throw new Error("A defineEval normal path requires at least one Fact verdict use");
      }
    });
  }

  /** Runner-only normal-return boundary for a score Eval. */
  completeScore(): void {
    this.completeNormalReturn();
  }

  private completeNormalReturn(validate?: () => void): void {
    this.beforeManagedBoundary("test return");
    validate?.();
    this.terminal = { kind: "finished" };
  }

  /**
   * Runner-only external-error boundary. This is deliberately not an author
   * assertion API: it seals already registered nodes without starting any new
   * evaluator, so timeout / infrastructure failure cannot race a late result.
   */
  finalizeForRunnerError(issue: ErrorAttemptIssue): FactFinalizeResult {
    if (this.runnerErrorFinalization !== undefined) return this.runnerErrorFinalization;

    const reason = issue.error.message;
    this.terminal = { kind: "error", reason };
    const facts = this.nodes.map((node) => {
      if (node.result !== undefined) return node.result;
      const result = node.evaluating === undefined
        ? this.notReached(node, "notReachedByError", reason)
        : this.baseResult(node, {
            outcome: "errored",
            error: this.interruptedEvaluatorError(node.name, reason),
          });
      node.result = result;
      return result;
    });
    const uses = this.buildUses();
    const graph = {
      factResults: Object.freeze(facts),
      factUses: Object.freeze(uses),
    };
    const finalized: FactFinalizeResult = {
      ...graph,
      pass: this.foldPass(graph, [issue]),
      score: this.foldScore(graph, [issue]),
    };
    this.runnerErrorFinalization = Object.freeze(finalized);
    return this.runnerErrorFinalization;
  }

  closeForSkip(reason: string): void {
    if (this.terminal === undefined || this.terminal.kind === "finished") this.terminal = { kind: "skipped", reason };
  }

  async finalize(context: AssertionEvaluationContext, options: FactFinalizeOptions = {}): Promise<FactFinalizeResult> {
    if (this.runnerErrorFinalization !== undefined) return this.runnerErrorFinalization;
    const control = this.terminal?.kind === "control" ? this.terminal : undefined;
    const stoppedByError = this.terminal?.kind === "error" || this.terminal?.kind === "skipped";
    const reachable = this.reachableNodes();
    const judgeNodes = this.nodes.filter((node) => reachable.has(node) && node.judge !== undefined && node.result === undefined);
    let judgeIndex = 0;
    const facts: EvaluationFactResult[] = [];
    for (const node of this.nodes) {
      if (node.result !== undefined) {
        facts.push(node.result);
        continue;
      }
      if (!reachable.has(node) || control !== undefined || stoppedByError) {
        const reason = control?.signal.message ?? this.terminalReason("not reached");
        const outcome = control === undefined && this.terminal?.kind === "error" ? "notReachedByError" : "notReachedByControl";
        const result = this.notReached(node, outcome, reason);
        node.result = result;
        facts.push(result);
        continue;
      }
      if (node.judge !== undefined) {
        judgeIndex += 1;
        options.onJudgeProgress?.({ index: judgeIndex, total: judgeNodes.length, check: node.judge.check });
      }
      facts.push(await this.evaluateNode(node, context));
    }

    const uses = this.buildUses();
    const graph = { factResults: facts, factUses: uses };
    const externalErrors = options.externalErrors ?? [];
    return { ...graph, pass: this.foldPass(graph, externalErrors), score: this.foldScore(graph, externalErrors) };
  }

  private isFact(value: unknown): value is BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase> {
    return typeof value === "object" && value !== null && this.nodeByFact.has(value);
  }

  private nodeFor(fact: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>): FactNode {
    const node = typeof fact === "object" && fact !== null ? this.nodeByFact.get(fact) : undefined;
    if (node === undefined) throw new TypeError("Fact belongs to a different Attempt or was not created by this context");
    return node;
  }

  private assertCanRegister(): void {
    if (this.terminal?.kind === "control") throw this.terminal.signal;
    if (this.terminal !== undefined) throw new Error("The Fact collector is closed");
  }

  private addVerdictUse(
    node: FactNode,
    method: VerdictUseNode["method"],
    options: FactUseOptions | ScoreThresholdOptions | undefined,
    atLeast: number | undefined,
  ): VerdictUseNode {
    if (this.verdictUseByFact.has(node.fact)) throw new Error(`Fact ${node.name} already has a verdict use`);
    const use: VerdictUseNode = {
      kind: "verdict",
      node,
      method,
      ...(options?.label === undefined ? {} : { label: this.nonEmpty(options.label, `${method}() label`) }),
      key: this.validateKey(options?.key),
      ...(atLeast === undefined ? {} : { atLeast }),
      consumerLoc: captureLoc(),
      sourceOrder: this.nextSourceOrder(),
    };
    this.verdictUseByFact.set(node.fact, use);
    this.uses.push(use);
    return use;
  }

  private thresholdOptions(options: FactUseOptions | ScoreThresholdOptions | undefined, method: string): number {
    if (options === undefined || !("atLeast" in options)) {
      throw new TypeError(`${method}() needs { atLeast } for a Score Fact`);
    }
    this.assertThreshold(options.atLeast, `${method}() atLeast`);
    return options.atLeast;
  }

  private assertThreshold(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${label} must be a finite number in [0, 1]`);
    }
  }

  private assertLabel(value: string, owner: string): void {
    this.nonEmpty(value, `${owner} label`);
  }

  private nonEmpty(value: string, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
    return value;
  }

  private validateKey(key: string | undefined): string | undefined {
    if (key === undefined) return undefined;
    if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(key)) {
      throw new TypeError("Fact use key must match [a-z0-9][a-z0-9._/-]{0,127}");
    }
    if (this.keys.has(key)) throw new Error(`Fact use key ${JSON.stringify(key)} is already used`);
    this.keys.add(key);
    return key;
  }

  private assertNoDanglingFacts(): void {
    const reachable = this.reachableNodes();
    const dangling = this.nodes.find((node) => !reachable.has(node));
    if (dangling !== undefined) {
      throw new Error(`Evaluation Fact ${JSON.stringify(dangling.name)} has no assert, require, or score use`);
    }
  }

  private reachableNodes(): Set<FactNode> {
    const roots = this.uses.flatMap((use) => (use.kind === "score" && use.input === "direct" ? [] : [use.node]));
    const reachable = new Set<FactNode>();
    const visit = (node: FactNode): void => {
      if (reachable.has(node)) return;
      reachable.add(node);
      for (const dependency of node.dependencies) visit(dependency);
    };
    for (const root of roots) visit(root);
    return reachable;
  }

  private managedRequirement<R>(requirement: Requirement<R>): Promise<R> {
    const observe = (): Promise<R> => {
      if (requirement.state === "created") requirement.state = "observed-pending";
      return requirement.promise!;
    };
    const finishContinuation = (): void => {
      requirement.pendingContinuations -= 1;
      this.maybeSettleRequirement(requirement);
    };
    const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
      typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
    const observeThen = <TResult1 = R, TResult2 = never>(
      onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> => {
      const base = observe();
      requirement.pendingContinuations += 1;
      const invoke = (callback: ((value: unknown) => unknown) | null | undefined, value: unknown, rejected: boolean): unknown => {
        try {
          const output = callback === undefined || callback === null
            ? (rejected ? Promise.reject(value) : value)
            : callback(value);
          if (isPromiseLike(output)) {
            return Promise.resolve(output).then(
              (resolved) => {
                finishContinuation();
                return resolved;
              },
              (error) => {
                finishContinuation();
                throw error;
              },
            );
          }
          // Native `await` supplies a resolving callback that returns void.
          // Marking it settled synchronously here happens before the awaiting
          // function resumes at its next managed boundary.
          finishContinuation();
          return output;
        } catch (error) {
          finishContinuation();
          throw error;
        }
      };
      return base.then(
        (value) => invoke(onfulfilled as ((value: unknown) => unknown) | null | undefined, value, false) as TResult1,
        (error) => invoke(onrejected as ((value: unknown) => unknown) | null | undefined, error, true) as TResult2,
      );
    };
    const thenable = {
      then: <TResult1 = R, TResult2 = never>(
        onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> => observeThen(onfulfilled, onrejected),
      catch: <TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<R | TResult> =>
        observeThen(undefined, onrejected),
      finally: (onfinally?: (() => void) | null): Promise<R> =>
        observeThen(
          async (value) => {
            onfinally?.();
            return value;
          },
          async (error) => {
            onfinally?.();
            throw error;
          },
        ) as Promise<R>,
      [Symbol.toStringTag]: "Promise",
    };
    return thenable as Promise<R>;
  }

  private async settleRequirement<R>(requirement: Requirement<R>): Promise<R> {
    try {
      const context = await this.liveContext();
      const result = await this.evaluateNode(requirement.node, context);
      const passed = this.usePassed(requirement.use, result);
      if (passed) return requirement.node.value as R;
      throw this.terminateByName(requirement.use.label ?? requirement.node.name);
    } finally {
      requirement.baseSettled = true;
      this.maybeSettleRequirement(requirement);
    }
  }

  private maybeSettleRequirement(requirement: Requirement<unknown>): void {
    if (requirement.baseSettled && requirement.pendingContinuations === 0) requirement.state = "settled";
  }

  private usePassed(use: VerdictUseNode, result: EvaluationFactResult): boolean {
    if (result.outcome === "passed") return true;
    if (result.outcome === "scored") return result.normalizedScore >= (use.atLeast ?? 1);
    return false;
  }

  private terminateByName(name: string): EvalRequirementFailed {
    if (this.terminal?.kind === "control") return this.terminal.signal;
    const signal = new EvalRequirementFailed(name);
    if (this.terminal === undefined) this.terminal = { kind: "control", signal };
    return signal;
  }

  private async evaluateNode(node: FactNode, context: AssertionEvaluationContext): Promise<EvaluationFactResult> {
    if (node.result !== undefined) return node.result;
    if (node.evaluating !== undefined) return node.evaluating;
    const evaluate = async (): Promise<EvaluationFactResult> => {
      const unavailableReason = node.evidence === undefined ? undefined : this.unavailableEvidence.get(node.evidence);
      if (unavailableReason !== undefined) {
        const result = this.baseResult(node, { outcome: "unavailable", reason: unavailableReason });
        node.result = result;
        return result;
      }
      try {
        for (const dependency of node.dependencies) await this.evaluateNode(dependency, context);
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        const raw = this.validateRuntimeOutcome(node, await node.evaluate(context));
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        if (raw.outcome === "unavailable") {
          node.usageUnavailableAtCreation = node.usageEvidence && raw.usageUnavailableAtCreation === true;
        }
        if (raw.outcome === "passed" && raw.value !== undefined) node.value = raw.value;
        if (raw.outcome === "scored") node.value = raw.normalizedScore;
        const result = this.baseResult(node, raw);
        node.result = result;
        return result;
      } catch (error) {
        if (this.runnerErrorFinalization !== undefined && node.result !== undefined) return node.result;
        const result = this.baseResult(node, { outcome: "errored", error: evaluatorError(error) });
        node.result = result;
        return result;
      }
    };
    node.evaluating = node.judge === undefined ? evaluate() : this.inJudgeLane(evaluate);
    return node.evaluating;
  }

  private inJudgeLane<T>(evaluate: () => Promise<T>): Promise<T> {
    const current = this.judgeEvaluationTail.then(evaluate, evaluate);
    this.judgeEvaluationTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private baseResult(node: FactNode, outcome: FactRuntimeOutcome): EvaluationFactResult {
    const base = {
      factId: node.id,
      name: node.name,
      ...(node.groupPath === undefined ? {} : { groupPath: node.groupPath }),
      ...(node.producerLoc === undefined ? {} : { producerLoc: node.producerLoc }),
      sourceOrder: node.sourceOrder,
      dependencyFactIds: node.dependencies.map((dependency) => dependency.id),
    };
    if (outcome.outcome === "passed" || outcome.outcome === "failed") {
      return {
        ...base,
        factKind: "boolean",
        outcome: outcome.outcome,
        ...(outcome.expected === undefined ? {} : { expected: outcome.expected }),
        ...(outcome.received === undefined ? {} : { received: outcome.received }),
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
        ...(outcome.explanation === undefined ? {} : { explanation: outcome.explanation }),
      };
    }
    if (outcome.outcome === "scored") {
      return {
        ...base,
        factKind: "score",
        outcome: "scored",
        normalizedScore: outcome.normalizedScore,
        ...(outcome.expected === undefined ? {} : { expected: outcome.expected }),
        ...(outcome.received === undefined ? {} : { received: outcome.received }),
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
        ...(outcome.explanation === undefined ? {} : { explanation: outcome.explanation }),
      };
    }
    if (outcome.outcome === "unavailable") {
      return {
        ...base,
        factKind: node.kind,
        outcome: "unavailable",
        reason: outcome.reason,
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      };
    }
    if (outcome.outcome === "errored") {
      return { ...base, factKind: node.kind, outcome: "errored", error: outcome.error };
    }
    throw new TypeError(`Fact ${node.name} returned an unsupported evaluator outcome`);
  }

  /**
   * Evaluator callbacks are user-adjacent code. Keep malformed values inside
   * the ordinary Fact error channel rather than trusting their TypeScript
   * annotation, and reject bad scores instead of silently clamping them.
   */
  private validateRuntimeOutcome(node: FactNode, value: unknown): FactRuntimeOutcome {
    if (typeof value !== "object" || value === null || !("outcome" in value)) {
      return { outcome: "errored", error: { class: "evaluator", code: "invalid-evaluator-result", message: `Fact ${JSON.stringify(node.name)} returned no evaluator outcome` } };
    }
    const result = value as globalThis.Record<string, unknown>;
    const outcome = result.outcome;
    if (outcome === "unavailable") {
      if (typeof result.reason !== "string" || result.reason.length === 0) {
        return { outcome: "errored", error: { class: "evaluator", code: "invalid-evaluator-result", message: `Fact ${JSON.stringify(node.name)} returned an unavailable result without a reason` } };
      }
      return value as FactRuntimeOutcome;
    }
    if (outcome === "errored") {
      const error = result.error;
      if (typeof error !== "object" || error === null || (error as { class?: unknown }).class !== "evaluator") {
        return { outcome: "errored", error: { class: "evaluator", code: "invalid-evaluator-result", message: `Fact ${JSON.stringify(node.name)} returned an invalid evaluator error` } };
      }
      return value as FactRuntimeOutcome;
    }
    if (node.kind === "boolean" && (outcome === "passed" || outcome === "failed")) return value as FactRuntimeOutcome;
    if (node.kind === "score" && outcome === "scored") {
      if (!Number.isFinite(result.normalizedScore) || (result.normalizedScore as number) < 0 || (result.normalizedScore as number) > 1) {
        return {
          outcome: "errored",
          error: {
            class: "evaluator",
            code: "invalid-score",
            message: `Fact ${JSON.stringify(node.name)} returned a score outside finite [0, 1]`,
          },
        };
      }
      return value as FactRuntimeOutcome;
    }
    return {
      outcome: "errored",
      error: {
        class: "evaluator",
        code: "invalid-evaluator-result",
        message: `Fact ${JSON.stringify(node.name)} returned ${JSON.stringify(outcome)} for a ${node.kind} Fact`,
      },
    };
  }

  private notReached(
    node: FactNode,
    outcome: "notReachedByControl" | "notReachedByError",
    reason: string,
  ): EvaluationFactResult {
    return {
      factId: node.id,
      name: node.name,
      ...(node.groupPath === undefined ? {} : { groupPath: node.groupPath }),
      ...(node.producerLoc === undefined ? {} : { producerLoc: node.producerLoc }),
      sourceOrder: node.sourceOrder,
      dependencyFactIds: node.dependencies.map((dependency) => dependency.id),
      factKind: node.kind,
      outcome,
      reason,
    };
  }

  private terminalReason(fallback: string): string {
    if (this.terminal?.kind === "error" || this.terminal?.kind === "skipped") return this.terminal.reason;
    if (this.terminal?.kind === "control") return this.terminal.signal.message;
    return fallback;
  }

  private buildUses(): Array<VerdictFactUseResult | ScoreFactUseResult> {
    return this.uses.map((use) => {
      if (use.kind === "score" && use.input === "direct") {
        // Direct scores are complete at the declaration point. A later
        // controlled stop cannot retroactively make a declared number
        // unreachable.
        return {
          useKind: "score",
          label: use.label,
          ...(use.key === undefined ? {} : { key: use.key }),
          ...(use.consumerLoc === undefined ? {} : { consumerLoc: use.consumerLoc }),
          sourceOrder: use.sourceOrder,
          input: { kind: "direct", earned: use.earned },
          outcome: "scored",
          earned: use.earned,
        };
      }
      const result = use.node.result;
      const common = {
        ...(use.key === undefined ? {} : { key: use.key }),
        ...(use.consumerLoc === undefined ? {} : { consumerLoc: use.consumerLoc }),
        sourceOrder: use.sourceOrder,
      };
      if (use.kind === "verdict") {
        const target = use.node.kind === "boolean"
          ? { kind: "boolean" as const, factId: use.node.id }
          : { kind: "score" as const, factId: use.node.id, atLeast: use.atLeast! };
        const base = {
          ...common,
          useKind: "verdict" as const,
          method: use.method,
          ...(use.label === undefined ? {} : { label: use.label }),
          target,
        };
        if (result === undefined || result.outcome === "notReachedByControl" || result.outcome === "notReachedByError") {
          return {
            ...base,
            outcome: result?.outcome ?? "notReachedByControl",
            reason: result?.outcome === "notReachedByError" || result?.outcome === "notReachedByControl" ? result.reason : this.terminalReason("not reached"),
          } as VerdictFactUseResult;
        }
        if (result.outcome === "unavailable") {
          return {
            ...base,
            outcome: use.method === "assertIfCovered" && use.node.usageUnavailableAtCreation
              ? "notApplicable"
              : "unavailable",
            reason: result.reason,
          } as VerdictFactUseResult;
        }
        if (result.outcome === "errored") return { ...base, outcome: "errored", error: result.error } as VerdictFactUseResult;
        return { ...base, outcome: this.usePassed(use, result) ? "passed" : "failed" } as VerdictFactUseResult;
      }
      const base = {
        ...common,
        useKind: "score" as const,
        label: use.label,
        input: { kind: "fact" as const, factId: use.node.id, max: use.max },
      };
      if (result === undefined || result.outcome === "notReachedByControl" || result.outcome === "notReachedByError") {
        return {
          ...base,
          outcome: result?.outcome ?? "notReachedByControl",
          reason: result?.outcome === "notReachedByError" || result?.outcome === "notReachedByControl" ? result.reason : this.terminalReason("not reached"),
        } as ScoreFactUseResult;
      }
      if (result.outcome === "unavailable") return { ...base, outcome: "unavailable", reason: result.reason } as ScoreFactUseResult;
      if (result.outcome === "errored") return { ...base, outcome: "errored", error: result.error } as ScoreFactUseResult;
      const normalized = result.outcome === "passed"
        ? 1
        : result.outcome === "failed"
          ? 0
          : result.outcome === "scored"
            ? result.normalizedScore
            : (() => {
                throw new TypeError(`Fact ${use.node.name} returned an unsupported score outcome`);
              })();
      return { ...base, outcome: "scored", earned: use.max * normalized } as ScoreFactUseResult;
    });
  }

  private interruptedEvaluatorError(name: string, reason: string): EvaluationFactError {
    return {
      class: "evaluator",
      code: "evaluator-interrupted",
      message: `Evaluator ${JSON.stringify(name)} did not settle before the Attempt ended: ${reason}`,
    };
  }

  private foldPass(
    graph: Pick<FactFinalizeResult, "factResults" | "factUses">,
    externalErrors: readonly ErrorAttemptIssue[],
  ): import("./types.ts").PassFactAttemptOutcome {
    const issues = this.issues(graph, externalErrors);
    if (issues.errors.length > 0 || issues.unavailable.length > 0) {
      return { verdict: "errored", issues: [...issues.errors, ...issues.unavailable] as [AttemptFactIssue, ...AttemptFactIssue[]] };
    }
    if (graph.factUses.some((use): use is VerdictFactUseResult => use.useKind === "verdict" && use.outcome === "failed")) {
      return { verdict: "failed" };
    }
    if (this.terminal?.kind === "skipped") return { verdict: "skipped", reason: this.terminal.reason };
    const verdictUses = graph.factUses.filter((use): use is VerdictFactUseResult => use.useKind === "verdict");
    if (verdictUses.length > 0 && verdictUses.every((use) => use.outcome === "notApplicable")) {
      return { verdict: "skipped", reason: "all verdict uses were not applicable" };
    }
    return { verdict: "passed" };
  }

  private foldScore(graph: Pick<FactFinalizeResult, "factResults" | "factUses">, externalErrors: readonly ErrorAttemptIssue[]): ScoreFactAttemptOutcome {
    const uses = graph.factUses.filter((use): use is ScoreFactUseResult => use.useKind === "score");
    const earnedScore = uses.reduce((total, use) => total + (use.outcome === "scored" ? use.earned : 0), 0);
    const issues = this.issues(graph, externalErrors);
    const hardFailure = graph.factUses.some((use): use is VerdictFactUseResult => use.useKind === "verdict" && use.outcome === "failed");
    if (hardFailure) return { status: "invalid", earnedScore, creditedScore: 0, issues: [...issues.errors, ...issues.unavailable] };
    if (issues.errors.length > 0) {
      return {
        status: "errored",
        earnedScore,
        creditedScore: null,
        errors: issues.errors as [import("./types.ts").ErrorAttemptIssue, ...import("./types.ts").ErrorAttemptIssue[]],
        issues: issues.unavailable,
      };
    }
    if (issues.unavailable.length > 0) {
      return {
        status: "unavailable",
        earnedScore,
        creditedScore: null,
        issues: issues.unavailable as [import("./types.ts").UnavailableAttemptIssue, ...import("./types.ts").UnavailableAttemptIssue[]],
      };
    }
    if (this.terminal?.kind === "skipped") return { status: "skipped", earnedScore, creditedScore: null, reason: this.terminal.reason };
    return { status: "scored", earnedScore, creditedScore: earnedScore };
  }

  private issues(graph: Pick<FactFinalizeResult, "factResults" | "factUses">, externalErrors: readonly ErrorAttemptIssue[] = []): {
    errors: import("./types.ts").ErrorAttemptIssue[];
    unavailable: import("./types.ts").UnavailableAttemptIssue[];
  } {
    const errors: import("./types.ts").ErrorAttemptIssue[] = [...externalErrors];
    const unavailable: import("./types.ts").UnavailableAttemptIssue[] = [];
    for (const fact of graph.factResults) {
      if (fact.outcome === "errored") errors.push({ kind: "error", error: fact.error, factId: fact.factId });
      if (fact.outcome === "unavailable") {
        const consumers = graph.factUses.filter((use) =>
          use.useKind === "verdict"
            ? use.target.factId === fact.factId
            : use.input.kind === "fact" && use.input.factId === fact.factId,
        );
        // A core usage Fact whose *only* consumers became notApplicable is
        // deliberately not an Attempt issue. It still keeps its unavailable
        // Fact row and its explicit notApplicable use in the graph; a score
        // consumer, ordinary assert, or dependency-only node remains honest
        // evidence insufficiency.
        const allNotApplicable = consumers.length > 0 && consumers.every(
          (use) => use.useKind === "verdict" && use.outcome === "notApplicable",
        );
        if (!allNotApplicable) unavailable.push({ kind: "unavailable", reason: fact.reason, factId: fact.factId });
      }
    }
    return { errors, unavailable };
  }
}

function evaluatorError(error: unknown): EvaluationFactError {
  return {
    class: "evaluator",
    code: "evaluator-defect",
    message: error instanceof Error ? error.message : String(error),
  };
}
