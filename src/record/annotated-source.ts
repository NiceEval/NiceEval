// 面无关的完整源码调用树与面相关投影。AttemptEvidence 只保存完整树；text、web 与 JSON
// 都消费 projectSourceView() 产出的同一个 SourceContent，不各自重分桶或猜入口文件。

import type { PhaseTiming, SourceArtifact, SourceLoc, StreamEvent } from "../types.ts";
import type {
  EvaluationFactResult,
  LegacyJudgeAssertionResult,
  ScoreFactUseResult,
  VerdictFactUseResult,
} from "../assertions/types.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
import { formatTurnLabel } from "../shared/turn-label.ts";

/**
 * 标回 `t.send(...)` 调用行的一轮 turn 头行事实(契约见 docs/feature/reports/show.md
 * 「--eval:把断言放回源码」)。身份标签与 --execution / --timing / diff windows 同一套;
 * 回复全文与轮内卡片不进这个模型——源码页只回答「这行代码对应哪一轮、这一轮成了没成」。
 */
export interface SendAnnotation {
  /** `turn<N>` 或 `session<K>/turn<N>`；已有 artifact 标签按不透明字符串保留。 */
  label: string;
  /** 轮的终态;时间树只记 failed 位,waiting 需要事件流佐证时由派生方给。 */
  status: "completed" | "failed" | "waiting";
  /** 该轮墙钟;时间树缺这一轮的节点时省略。 */
  durationMs?: number;
  /** send 调用位置(用户消息事件的 loc)。 */
  loc: SourceLoc;
  /** 与断言、直接给分共用的 attempt 级发生顺序；历史事件可省略。 */
  sourceOrder?: number;
}

/**
 * 从标准事件流与阶段时间树派生 send 标注:第 i 条用户消息开第 i 轮(与 --execution 的
 * 分轮边界同一条规则,见 show/render.ts::executionText),头行事实取 `eval.run` 下第 i 个
 * turn 节点;用户消息没有 loc 的轮不产出标注。纯函数,无 IO。
 */
export function deriveSendAnnotations(
  events: readonly StreamEvent[] | null,
  phases: readonly PhaseTiming[] | undefined,
): SendAnnotation[] {
  if (!events || events.length === 0) return [];
  const turnNodes = (phases ?? []).flatMap((p) => p.children ?? []).filter((n) => n.key === "agent.turn");
  const out: SendAnnotation[] = [];
  let turnIndex = -1;
  for (const event of events) {
    if (event.type !== "message" || event.role !== "user") continue;
    turnIndex += 1;
    if (!event.loc) continue;
    const turn = turnNodes[turnIndex];
    out.push({
      label: turn?.label ?? formatTurnLabel(1, turnIndex + 1),
      status: turn?.failed ? "failed" : "completed",
      ...(turn !== undefined ? { durationMs: turn.durationMs } : {}),
      ...(event.sourceOrder !== undefined ? { sourceOrder: event.sourceOrder } : {}),
      loc: event.loc,
    });
  }
  return out;
}

/** 调用树的面无关完整证据。 */
export type LineAnnotation =
  | { kind: "fact"; fact: EvaluationFactResult }
  | { kind: "factUse"; use: VerdictFactUseResult | ScoreFactUseResult }
  | { kind: "legacyJudge"; judge: LegacyJudgeAssertionResult }
  | { kind: "send"; send: SendAnnotation };

export interface SourceTreeLine {
  line: number;
  text: string;
  annotations: LineAnnotation[];
  calls: SourceCall[];
  aborted?: true;
}
export interface SourceNode {
  file: string;
  sha256: string;
  lines: SourceTreeLine[];
}
export interface SourceCall {
  summary: SourceCallSummary;
  target:
    | { kind: "source"; node: SourceNode }
    | { kind: "package"; package: string; calls: SourceCall[] }
    | {
        kind: "unavailable";
        file: string;
        line?: number;
        annotations: LineAnnotation[];
        calls: SourceCall[];
      };
}
export interface SourceCallSummary {
  checks: number;
  passed: number;
  failed: number;
  unavailable: number;
  points?: { earned: number; available: number };
  aborted: boolean;
}
export interface AnnotatedSourceTree {
  spine: SourceNode;
  detached: SourceNode[];
  unmapped: {
    facts: EvaluationFactResult[];
    uses: (VerdictFactUseResult | ScoreFactUseResult)[];
    legacyJudgeAssertions: LegacyJudgeAssertionResult[];
  };
  summary: SourceCallSummary;
}

export interface ProjectedSourceLine extends Omit<SourceTreeLine, "calls"> {
  calls: ProjectedSourceCall[];
}
export interface SourceContentNode extends Omit<SourceNode, "lines"> {
  lines: ProjectedSourceLine[];
}
export interface ProjectedSourceCall extends Omit<SourceCall, "target"> {
  open: boolean;
  target:
    | { kind: "source"; node: SourceContentNode }
    | { kind: "package"; package: string; calls: ProjectedSourceCall[] }
    | {
        kind: "unavailable";
        file: string;
        line?: number;
        annotations: LineAnnotation[];
        calls: ProjectedSourceCall[];
      };
}
export interface SourceContent extends Omit<AnnotatedSourceTree, "spine" | "detached"> {
  spine: SourceContentNode;
  detached: SourceContentNode[];
}

/** 用 entry role 决定主干，绝不按命中数猜入口。 */
export function assembleSourceTree(input: {
  entry: SourceArtifact;
  sources: readonly SourceArtifact[];
  factResults: readonly EvaluationFactResult[];
  factUses: readonly (VerdictFactUseResult | ScoreFactUseResult)[];
  legacyJudgeAssertions: readonly LegacyJudgeAssertionResult[];
  sends: readonly SendAnnotation[];
  abort?: SourceLoc;
}): AnnotatedSourceTree {
  const artifacts = new Map(input.sources.map((s) => [s.path, s]));
  artifacts.set(input.entry.path, { ...input.entry, role: "entry" });
  const makeNode = (file: string): SourceNode | undefined => {
    const source = artifacts.get(file);
    if (!source) return undefined;
    const body = normalizeEvalSource(source.content).replace(/\n$/, "");
    return {
      file,
      sha256: hashEvalSource(normalizeEvalSource(source.content)),
      lines: (body === "" ? [""] : body.split("\n")).map((text, i) => ({ line: i + 1, text, annotations: [], calls: [] })),
    };
  };
  const spine = makeNode(input.entry.path);
  if (!spine) throw new Error(`Entry source is missing from the captured source set: ${input.entry.path}`);
  const detached: SourceNode[] = [];
  const unmapped: AnnotatedSourceTree["unmapped"] = { facts: [], uses: [], legacyJudgeAssertions: [] };
  const abortedCalls = new Set<SourceCall>();

  const findOrCreateDetached = (file: string): SourceNode | undefined => {
    const found = detached.find((candidate) => candidate.file === file);
    if (found) return found;
    const made = makeNode(file);
    if (made) detached.push(made);
    return made;
  };

  const callListAt = (node: SourceNode, frame: { line: number }): SourceCall[] | undefined =>
    node.lines[frame.line - 1]?.calls;

  const sourceCall = (calls: SourceCall[], file: string, line: number): SourceCall => {
    let call = calls.find((candidate) =>
      (candidate.target.kind === "source" && candidate.target.node.file === file) ||
      (candidate.target.kind === "unavailable" && candidate.target.file === file)
    );
    if (call) return call;
    const target = makeNode(file);
    // 帧里的行号是进入该文件后继续下钻或落声明的位置。正文存在但行号越界时，
    // 这段路径同样不可定位，必须保留为 unavailable，不能把痕迹丢进 unmapped。
    const targetAvailable = target?.lines[line - 1] !== undefined;
    call = {
      summary: emptySummary(),
      target: targetAvailable
        ? { kind: "source", node: target }
        : { kind: "unavailable", file, line, annotations: [], calls: [] },
    };
    calls.push(call);
    return call;
  };

  const packageCall = (calls: SourceCall[], packageName: string): SourceCall => {
    let call = calls.find((candidate) =>
      candidate.target.kind === "package" && candidate.target.package === packageName
    );
    if (call) return call;
    call = {
      summary: emptySummary(),
      target: { kind: "package", package: packageName, calls: [] },
    };
    calls.push(call);
    return call;
  };

  const add = (
    annotation: LineAnnotation | undefined,
    loc: SourceLoc | undefined,
    kind: LineAnnotation["kind"] | "abort",
  ) => {
    if (!loc) {
      if (annotation?.kind === "fact") unmapped.facts.push(annotation.fact);
      if (annotation?.kind === "factUse") unmapped.uses.push(annotation.use);
      if (annotation?.kind === "legacyJudge") unmapped.legacyJudgeAssertions.push(annotation.judge);
      return;
    }
    const declaration = {
      kind: "project" as const,
      file: loc.file,
      line: loc.line,
      ...(loc.column !== undefined ? { column: loc.column } : {}),
    };
    const frames = [...(loc.callers ?? []), declaration];
    const spineFrameIndexes = frames.flatMap((frame, index) =>
      frame.kind === "project" && frame.file === spine.file ? [index] : []
    );
    const anchorIndex = spineFrameIndexes.at(-1) ?? frames.findIndex((frame) => frame.kind === "project");
    if (anchorIndex < 0) return;
    const anchorFrame = frames[anchorIndex]!;
    if (anchorFrame.kind !== "project") return;
    let currentNode = anchorFrame.file === spine.file
      ? spine
      : findOrCreateDetached(anchorFrame.file);
    let currentProjectFrame = anchorFrame;
    let nestedCalls: SourceCall[] | undefined;
    const pathCalls: SourceCall[] = [];

    for (let index = anchorIndex + 1; index < frames.length; index += 1) {
      const frame = frames[index]!;
      const calls = nestedCalls ?? (currentNode ? callListAt(currentNode, currentProjectFrame) : undefined);
      if (!calls) break;
      if (frame.kind === "package") {
        const call = packageCall(calls, frame.package);
        if (call.target.kind !== "package") break;
        pathCalls.push(call);
        nestedCalls = call.target.calls;
        continue;
      }
      // 连续项目帧保留每层调用边；同一行、同一路径段才合并。
      const call = sourceCall(calls, frame.file, frame.line);
      pathCalls.push(call);
      currentProjectFrame = frame;
      nestedCalls = undefined;
      if (call.target.kind === "source") {
        currentNode = call.target.node;
      } else if (call.target.kind === "unavailable") {
        currentNode = undefined;
        nestedCalls = call.target.calls;
        if (index === frames.length - 1 && annotation) call.target.annotations.push(annotation);
      }
    }

    const leaf = currentNode?.file === loc.file ? currentNode.lines[loc.line - 1] : undefined;
    if (kind === "abort") for (const call of pathCalls) abortedCalls.add(call);
    if (leaf) {
      if (kind === "abort") leaf.aborted = true;
      else if (annotation) leaf.annotations.push(annotation);
      return;
    }
    // 只有真正没有 loc 的断言/给分进 unmapped。有 loc 但源码或行不可用时，
    // 路径上的 unavailable 段已承载它，不降级成“无位置”。
  };
  for (const item of sortSourceAnnotations(input)) add(item.annotation, item.loc, item.annotation.kind);
  if (input.abort) add(undefined, input.abort, "abort");

  summarizeNode(spine, abortedCalls);
  for (const node of detached) summarizeNode(node, abortedCalls);
  const summary = addSummaries(
    [summaryOfNode(spine), ...detached.map(summaryOfNode), summaryOfUnmapped(unmapped)],
  );
  return { spine, detached, unmapped, summary };
}

type SourceAnnotationKind = LineAnnotation["kind"];

interface SourceAnnotationInput {
  annotation: LineAnnotation;
  loc: SourceLoc | undefined;
  sequence: SourceAnnotationSequence;
}

/**
 * Fact producer、Fact consumer、legacy Judge sidecar 与 send 都有 sourceOrder，因而能恢复真正
 * 的跨数组发生顺序。缺字段的第三方记录只保留各自存储桶内的稳定顺序；绝不把这个回退位置
 * 解释成不同事实之间的实际先后。
 */
type SourceAnnotationSequence =
  | { kind: "recorded"; sourceOrder: number; inputIndex: number }
  | { kind: "legacy"; sourceKind: SourceAnnotationKind; inputIndex: number };

const legacySourceKindRank: Readonly<Record<SourceAnnotationKind, number>> = {
  fact: 0,
  factUse: 1,
  legacyJudge: 2,
  send: 3,
};

function sortSourceAnnotations(input: {
  factResults: readonly EvaluationFactResult[];
  factUses: readonly (VerdictFactUseResult | ScoreFactUseResult)[];
  legacyJudgeAssertions: readonly LegacyJudgeAssertionResult[];
  sends: readonly SendAnnotation[];
}): SourceAnnotationInput[] {
  const inputs: SourceAnnotationInput[] = [];
  const addInputs = <T>(
    values: readonly T[],
    makeAnnotation: (value: T) => LineAnnotation,
    sourceOrder: (value: T) => number | undefined,
  ) => {
    for (const [inputIndex, value] of values.entries()) {
      const annotation = makeAnnotation(value);
      const order = sourceOrder(value);
      inputs.push({
        annotation,
        loc: annotation.kind === "send"
          ? annotation.send.loc
          : annotation.kind === "fact"
            ? annotation.fact.producerLoc
            : annotation.kind === "factUse"
              ? annotation.use.consumerLoc
              : annotation.judge.loc,
        sequence: order === undefined
          ? { kind: "legacy", sourceKind: annotation.kind, inputIndex }
          : { kind: "recorded", sourceOrder: order, inputIndex },
      });
    }
  };
  addInputs(input.factResults, (fact) => ({ kind: "fact", fact }), (fact) => fact.sourceOrder);
  addInputs(input.factUses, (use) => ({ kind: "factUse", use }), (use) => use.sourceOrder);
  addInputs(input.legacyJudgeAssertions, (judge) => ({ kind: "legacyJudge", judge }), (judge) => judge.sourceOrder);
  addInputs(input.sends, (send) => ({ kind: "send", send }), (send) => send.sourceOrder);
  return inputs.sort(compareSourceAnnotationSequence);
}

function compareSourceAnnotationSequence(left: SourceAnnotationInput, right: SourceAnnotationInput): number {
  const leftSequence = left.sequence;
  const rightSequence = right.sequence;
  if (leftSequence.kind === "recorded" && rightSequence.kind === "recorded") {
    return leftSequence.sourceOrder - rightSequence.sourceOrder ||
      legacySourceKindRank[left.annotation.kind] - legacySourceKindRank[right.annotation.kind] ||
      leftSequence.inputIndex - rightSequence.inputIndex;
  }
  if (leftSequence.kind === "recorded") return -1;
  if (rightSequence.kind === "recorded") return 1;
  return legacySourceKindRank[leftSequence.sourceKind] - legacySourceKindRank[rightSequence.sourceKind] ||
    leftSequence.inputIndex - rightSequence.inputIndex;
}

/** 唯一的裁行入口；full/file/default/web 不会改变完整树或事实顺序。 */
export function projectSourceView(
  source: AnnotatedSourceTree,
  options: { mode: "default" | "full" | "file" | "web"; file?: string; budgetLines?: number },
): SourceContent {
  const projectCall = (call: SourceCall, depth: number): ProjectedSourceCall => {
    const open = options.mode === "full" ||
      ((options.mode === "default" || options.mode === "web") && needsAttention(call.summary));
    if (call.target.kind === "source") {
      return {
        summary: call.summary,
        open,
        target: { kind: "source", node: projectNode(call.target.node, false, depth + 1) },
      };
    }
    if (call.target.kind === "package") {
      return {
        summary: call.summary,
        open,
        target: { kind: "package", package: call.target.package, calls: call.target.calls.map((child) => projectCall(child, depth + 1)) },
      };
    }
    return {
      summary: call.summary,
      open,
      target: {
        kind: "unavailable",
        file: call.target.file,
        ...(call.target.line !== undefined ? { line: call.target.line } : {}),
        annotations: call.target.annotations,
        calls: call.target.calls.map((child) => projectCall(child, depth + 1)),
      },
    };
  };

  const projectNode = (node: SourceNode, isSpine: boolean, depth: number): SourceContentNode => {
    const selected = options.mode === "file"
      ? node.lines
      : selectSourceLines(node.lines, isSpine ? 3 : 2, isSpine ? 8 : 4);
    return {
      file: node.file,
      sha256: node.sha256,
      lines: selected.map((line) => ({
        ...line,
        calls: line.calls.map((call) => projectCall(call, depth)),
      })),
    };
  };

  if (options.mode === "file" && options.file !== undefined) {
    const nodes = collectNodes(source).filter((node) => node.file === options.file);
    if (nodes.length > 0) {
      const merged = mergeFileNodes(nodes);
      return { ...source, spine: projectNode(merged, true, 0), detached: [] };
    }
    throw new Error(`Captured source file not found in annotated source tree: ${options.file}`);
  }

  const projected: SourceContent = {
    ...source,
    spine: projectNode(source.spine, true, 0),
    detached: source.detached.map((node) => projectNode(node, false, 0)),
  };
  if (options.mode === "default") applyLineBudget(projected, options.budgetLines ?? 400);
  return projected;
}

function emptySummary(): SourceCallSummary {
  return { checks: 0, passed: 0, failed: 0, unavailable: 0, aborted: false };
}

function annotationSummary(annotation: LineAnnotation): SourceCallSummary {
  if (annotation.kind === "send") return emptySummary();
  if (annotation.kind === "fact") {
    const outcome = annotation.fact.outcome;
    return {
      ...emptySummary(),
      checks: 1,
      passed: outcome === "passed" || outcome === "scored" ? 1 : 0,
      failed: outcome === "failed" ? 1 : 0,
      unavailable: outcome === "unavailable" || outcome === "errored" || outcome.startsWith("notReached") ? 1 : 0,
    };
  }
  if (annotation.kind === "factUse") {
    const use = annotation.use;
    if (use.useKind === "score") {
      if (use.outcome !== "scored") return { ...emptySummary(), unavailable: 1 };
      const available = use.input.kind === "fact" ? use.input.max : use.input.earned;
      return { ...emptySummary(), points: { earned: use.earned, available } };
    }
    return {
      ...emptySummary(),
      checks: 1,
      passed: use.outcome === "passed" ? 1 : 0,
      failed: use.outcome === "failed" ? 1 : 0,
      unavailable: use.outcome !== "passed" && use.outcome !== "failed" ? 1 : 0,
    };
  }
  const judge = annotation.judge;
  const base: SourceCallSummary = {
    ...emptySummary(),
    checks: 1,
    passed: judge.outcome === "passed" ? 1 : 0,
    failed: judge.outcome === "failed" ? 1 : 0,
    unavailable: judge.outcome !== "passed" && judge.outcome !== "failed" ? 1 : 0,
  };
  if (judge.policy.scoring.kind === "points") {
    base.points = {
      earned: "earnedPoints" in judge ? judge.earnedPoints : 0,
      available: judge.policy.scoring.max,
    };
  }
  return base;
}

function addSummaries(items: readonly SourceCallSummary[]): SourceCallSummary {
  const out = emptySummary();
  let earned = 0;
  let available = 0;
  let hasPoints = false;
  for (const item of items) {
    out.checks += item.checks;
    out.passed += item.passed;
    out.failed += item.failed;
    out.unavailable += item.unavailable;
    out.aborted ||= item.aborted;
    if (item.points) {
      hasPoints = true;
      earned += item.points.earned;
      available += item.points.available;
    }
  }
  if (hasPoints) out.points = { earned, available };
  return out;
}

function summaryOfTarget(target: SourceCall["target"]): SourceCallSummary {
  if (target.kind === "source") return summaryOfNode(target.node);
  const children = target.calls.map((call) => call.summary);
  if (target.kind === "package") return addSummaries(children);
  const own = target.annotations.map(annotationSummary);
  // 源码段本身不可用也是一个可观察的缺口，但绝不折成 failed。
  return addSummaries([{ ...emptySummary(), unavailable: 1 }, ...own, ...children]);
}

function summarizeCall(call: SourceCall, abortedCalls: ReadonlySet<SourceCall>): SourceCallSummary {
  if (call.target.kind === "source") summarizeNode(call.target.node, abortedCalls);
  else for (const child of call.target.calls) summarizeCall(child, abortedCalls);
  call.summary = addSummaries([
    summaryOfTarget(call.target),
    ...(abortedCalls.has(call) ? [{ ...emptySummary(), aborted: true }] : []),
  ]);
  return call.summary;
}

function summaryOfNode(node: SourceNode): SourceCallSummary {
  const parts: SourceCallSummary[] = [];
  for (const line of node.lines) {
    parts.push(...line.annotations.map(annotationSummary));
    parts.push(...line.calls.map((call) => call.summary));
    if (line.aborted) parts.push({ ...emptySummary(), aborted: true });
  }
  return addSummaries(parts);
}

function summarizeNode(node: SourceNode, abortedCalls: ReadonlySet<SourceCall>): SourceCallSummary {
  for (const line of node.lines) for (const call of line.calls) summarizeCall(call, abortedCalls);
  return summaryOfNode(node);
}

function summaryOfUnmapped(unmapped: AnnotatedSourceTree["unmapped"]): SourceCallSummary {
  return addSummaries([
    ...unmapped.facts.map((fact) => annotationSummary({ kind: "fact", fact })),
    ...unmapped.uses.map((use) => annotationSummary({ kind: "factUse", use })),
    ...unmapped.legacyJudgeAssertions.map((judge) => annotationSummary({ kind: "legacyJudge", judge })),
  ]);
}

function needsAttention(summary: SourceCallSummary): boolean {
  return summary.failed > 0 || summary.unavailable > 0 || summary.aborted ||
    (summary.points !== undefined && summary.points.earned < summary.points.available);
}

function selectSourceLines(
  lines: readonly SourceTreeLine[],
  radius: number,
  foldThreshold: number,
): SourceTreeLine[] {
  if (lines.length === 0) return [];
  const keep = new Set<number>();
  const essentials = lines.flatMap((line, index) =>
    line.annotations.length > 0 || line.calls.length > 0 || line.aborted ? [index] : []
  );
  for (const index of essentials) {
    for (let candidate = Math.max(0, index - radius); candidate <= Math.min(lines.length - 1, index + radius); candidate++) {
      keep.add(candidate);
    }
  }
  // 没有任何证据锦标时仍给读者一个有界的源码起点。
  if (essentials.length === 0) {
    for (let index = 0; index < Math.min(lines.length, radius + 1); index++) keep.add(index);
  }
  let gapStart = 0;
  while (gapStart < lines.length) {
    while (gapStart < lines.length && keep.has(gapStart)) gapStart++;
    if (gapStart >= lines.length) break;
    let gapEnd = gapStart;
    while (gapEnd + 1 < lines.length && !keep.has(gapEnd + 1)) gapEnd++;
    if (gapEnd - gapStart + 1 < foldThreshold) {
      for (let index = gapStart; index <= gapEnd; index++) keep.add(index);
    }
    gapStart = gapEnd + 1;
  }
  return lines.filter((_line, index) => keep.has(index));
}

function collectNodes(source: AnnotatedSourceTree): SourceNode[] {
  const nodes: SourceNode[] = [];
  const visitCalls = (calls: readonly SourceCall[]) => {
    for (const call of calls) {
      if (call.target.kind === "source") visitNode(call.target.node);
      else visitCalls(call.target.calls);
    }
  };
  const visitNode = (node: SourceNode) => {
    nodes.push(node);
    for (const line of node.lines) visitCalls(line.calls);
  };
  visitNode(source.spine);
  for (const node of source.detached) visitNode(node);
  return nodes;
}

/** 单文件模式把该路径在不同调用分支上的标注合回同一份全文。 */
function mergeFileNodes(nodes: readonly SourceNode[]): SourceNode {
  const first = nodes[0]!;
  const lines = first.lines.map((line) => ({ ...line, annotations: [...line.annotations], calls: [...line.calls] }));
  for (const node of nodes.slice(1)) {
    for (const line of node.lines) {
      const target = lines[line.line - 1];
      if (!target) continue;
      target.annotations.push(...line.annotations);
      target.calls.push(...line.calls);
      if (line.aborted) target.aborted = true;
    }
  }
  return { file: first.file, sha256: first.sha256, lines };
}

interface BudgetCandidate {
  call: ProjectedSourceCall;
  depth: number;
  severity: "soft" | "gate";
}

function failedSeverity(call: ProjectedSourceCall): "soft" | "gate" {
  const annotations: LineAnnotation[] = [];
  const visitCalls = (calls: readonly ProjectedSourceCall[]) => {
    for (const child of calls) {
      if (child.target.kind === "source") visitNode(child.target.node);
      else {
        if (child.target.kind === "unavailable") annotations.push(...child.target.annotations);
        visitCalls(child.target.calls);
      }
    }
  };
  const visitNode = (node: SourceContentNode) => {
    for (const line of node.lines) {
      annotations.push(...line.annotations);
      visitCalls(line.calls);
    }
  };
  if (call.target.kind === "source") visitNode(call.target.node);
  else {
    if (call.target.kind === "unavailable") annotations.push(...call.target.annotations);
    visitCalls(call.target.calls);
  }
  return annotations.some((annotation) =>
    (annotation.kind === "factUse" && annotation.use.useKind === "verdict" && annotation.use.method === "require" && annotation.use.outcome === "failed") ||
    (annotation.kind === "legacyJudge" && annotation.judge.policy.verdict.kind === "gate" && annotation.judge.outcome === "failed")
  ) ? "gate" : "soft";
}

function applyLineBudget(source: SourceContent, budget: number): void {
  const candidates: BudgetCandidate[] = [];
  const visibleLinesInCalls = (calls: readonly ProjectedSourceCall[], depth: number): number => {
    let count = 0;
    for (const call of calls) {
      if (call.open) {
        candidates.push({ call, depth, severity: failedSeverity(call) });
        if (call.target.kind === "source") {
          count += call.target.node.lines.length;
          count += call.target.node.lines.reduce((sum, line) => sum + visibleLinesInCalls(line.calls, depth + 1), 0);
        } else {
          count += visibleLinesInCalls(call.target.calls, depth + 1);
        }
      }
    }
    return count;
  };
  const rootLines = source.spine.lines.length + source.detached.reduce((sum, node) => sum + node.lines.length, 0);
  let visible = rootLines +
    source.spine.lines.reduce((sum, line) => sum + visibleLinesInCalls(line.calls, 1), 0) +
    source.detached.reduce((sum, node) => sum + node.lines.reduce((subtotal, line) => subtotal + visibleLinesInCalls(line.calls, 1), 0), 0);
  if (visible <= budget) return;
  candidates.sort((left, right) =>
    right.depth - left.depth ||
    (left.severity === right.severity ? 0 : left.severity === "soft" ? -1 : 1)
  );
  for (const candidate of candidates) {
    if (!candidate.call.open) continue;
    candidate.call.open = false;
    visible = visibleLineCount(source);
    if (visible <= budget) break;
  }
}

function visibleLineCount(source: SourceContent): number {
  const calls = (items: readonly ProjectedSourceCall[]): number => items.reduce((sum, call) => {
    if (!call.open) return sum;
    if (call.target.kind === "source") {
      return sum + call.target.node.lines.length + call.target.node.lines.reduce((nested, line) => nested + calls(line.calls), 0);
    }
    return sum + calls(call.target.calls);
  }, 0);
  const node = (value: SourceContentNode): number =>
    value.lines.length + value.lines.reduce((sum, line) => sum + calls(line.calls), 0);
  return node(source.spine) + source.detached.reduce((sum, value) => sum + node(value), 0);
}
