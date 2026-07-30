// AnnotatedEvalSource:标注 Eval 源码(定稿见 docs/concepts.md「结果数据与报告」、
// docs/concepts.md「Attempt 证据」)。把一份 eval 源码文本与该次运行产出的
// AssertionResult[] 叠在一起 —— 每条断言按 SourceLoc 标回源码行,没有(或够不上)行映射的
// 断言进 `unmapped` 桶,不静默丢弃。这是共享 model:未来的网页 CodeView 与
// `show --eval` 文本 renderer 只消费这同一份数据,不各自重新分桶。
//
// 泛化自 src/view/app/lib/transcript-data.tsx 的 indexAsserts()(Map<string, Assertion[]>
// + noloc 兜底桶的先例)——同一套"按 loc 分桶、没有 loc 进兜底"的思路,换成源码行数组
// (不是 Map)存放,外加 sourceSha256 / summary 计数。轮次的完整展开(events → ExecutionTree)
// 仍是 ExecutionTree 的地盘;这个模型只把每轮的头行事实标回 send 调用行(见 SendAnnotation),
// 作为源码页指向 --execution 的跨面指针。
//
// 本模块不 import react/jsx,纯数据 + 纯函数,可以在任何 Node 语境(CLI 的 show、
// view 的 server 端数据准备)调用。

import type { AssertionResult, PhaseTiming, ScoreEntry, SourceArtifact, SourceLoc, StreamEvent } from "../types.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";

/**
 * 标回 `t.send(...)` 调用行的一轮 turn 头行事实(契约见 docs/feature/reports/show.md
 * 「--eval:把断言放回源码」)。身份标签与 --execution / --timing / diff windows 同一套;
 * 回复全文与轮内卡片不进这个模型——源码页只回答「这行代码对应哪一轮、这一轮成了没成」。
 */
export interface SendAnnotation {
  /** `s<session>/t<turn>`。 */
  label: string;
  /** 轮的终态;时间树只记 failed 位,waiting 需要事件流佐证时由派生方给。 */
  status: "completed" | "failed" | "waiting";
  /** 该轮墙钟;时间树缺这一轮的节点时省略。 */
  durationMs?: number;
  /** send 调用位置(用户消息事件的 loc)。 */
  loc: SourceLoc;
}

/** 一行源码 + 映射到这一行的全部断言与 send 标注(保持原始顺序;可以是空数组)。 */
export interface AnnotatedSourceLine {
  /** 1-indexed 行号,与 SourceLoc.line 同一坐标系。 */
  line: number;
  /** 这一行的原始文本(已按 normalizeEvalSource 归一化,不含行尾换行符)。 */
  text: string;
  /**
   * 映射到这一行的断言,按输入顺序(通常即执行顺序)排列。每条断言自带 severity / score /
   * passed / detail / evidence —— 这就是"状态 / 严重度 / 分数 / detail / evidence"标回源码行
   * 的完整信息,不需要额外的行级折叠字段:折叠成单一显示态是 renderer 的展示决定,不是这份
   * 领域 model 的职责(与 indexAsserts() 的先例一致,它同样只分桶、不折叠)。
   */
  assertions: AssertionResult[];
  /**
   * 映射到这一行的 send 标注,按轮次顺序;循环里的 send 一行多轮。与断言的 never-drop
   * 契约不同,定位不到行的轮不进任何兜底桶——轮次的全量面是 --execution,这里只是指针。
   */
  sends: SendAnnotation[];
}

export interface AnnotatedEvalSourceSummary {
  /** 参与统计的断言总数 = mappedAssertions + unmappedAssertions。 */
  totalAssertions: number;
  /** 成功映射到某一行源码的断言数。 */
  mappedAssertions: number;
  /** 落进 unmapped 桶的断言数。 */
  unmappedAssertions: number;
  /** 按 passed 计票(映射与未映射的断言都计入)。 */
  passed: number;
  failed: number;
  /** 按 severity 计票(映射与未映射的断言都计入)。 */
  gate: number;
  soft: number;
  /** 源码总行数,等于 lines.length。 */
  totalLines: number;
  /** 至少挂了一条断言的行数。 */
  annotatedLines: number;
}

export interface AnnotatedEvalSource {
  /** 项目相对路径,与 SourceArtifact.path / SourceLoc.file 同一约定。 */
  sourcePath: string;
  /** 归一化后源码文本的 SHA-256(与 captureEvalSource() 的算法一致,见 source-hash.ts)。 */
  sourceSha256: string;
  lines: AnnotatedSourceLine[];
  /**
   * 没有落到 lines 里任何一行的断言,原始顺序保留,永不丢弃。三种情况都进这里:
   * 没有 SourceLoc(如 skip 前就出错的 eval、或调用方尚未收集到位置)、SourceLoc 指向
   * 另一个文件(loc.file !== sourcePath —— 罕见,如断言写在共享 helper 里)、
   * SourceLoc 的行号落在这份源码的行范围之外(源码与断言记录不同步的边界情况)。
   * 后两种不是文档明确要求的场景,但"never silently dropped"的契约对它们同样成立 ——
   * 这份 model 是分桶断言的唯一出口,不属于任何一行就必须出现在这里。
   */
  unmapped: AssertionResult[];
  summary: AnnotatedEvalSourceSummary;
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
      label: turn?.label ?? `t${turnIndex + 1}`,
      status: turn?.failed ? "failed" : "completed",
      ...(turn !== undefined ? { durationMs: turn.durationMs } : {}),
      loc: event.loc,
    });
  }
  return out;
}

/**
 * 纯函数:给定一份源码文本(未归一化也可以,内部会 normalizeEvalSource)与一批断言,
 * 产出标注好的 AnnotatedEvalSource。幂等 / 无 IO —— 可以在渲染路径上安全调用。
 *
 * 断言 → 源码行的映射规则:`a.loc` 存在、`a.loc.file === source.path`、且
 * `1 <= a.loc.line <= lines.length` 三者同时成立才落到对应行;否则进 `unmapped`。
 */
export function buildAnnotatedEvalSource(
  source: { path: string; content: string },
  assertions: readonly AssertionResult[],
  sends: readonly SendAnnotation[] = [],
): AnnotatedEvalSource {
  const normalized = normalizeEvalSource(source.content);
  // 末尾的单个换行符不产出幻影空行(源码文件几乎总以换行符收尾);中间的空行原样保留为一行。
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const rawLines = body.length === 0 && normalized.length === 0 ? [""] : body.split("\n");

  const lines: AnnotatedSourceLine[] = rawLines.map((text, i) => ({ line: i + 1, text, assertions: [], sends: [] }));

  for (const send of sends) {
    // 与断言同一条映射规则;不满足的轮直接丢(全量面在 --execution,见 SendAnnotation)。
    if (send.loc.file === source.path && send.loc.line >= 1 && send.loc.line <= lines.length) {
      lines[send.loc.line - 1]!.sends.push(send);
    }
  }

  const unmapped: AssertionResult[] = [];
  let mappedAssertions = 0;
  let passed = 0;
  let failed = 0;
  let gate = 0;
  let soft = 0;

  for (const assertion of assertions) {
    if (assertion.outcome === "passed") passed++;
    else failed++;
    if (assertion.severity === "gate") gate++;
    else soft++;

    const loc = assertion.loc;
    const target = loc && loc.file === source.path && loc.line >= 1 && loc.line <= lines.length ? lines[loc.line - 1] : undefined;
    if (target) {
      target.assertions.push(assertion);
      mappedAssertions++;
    } else {
      unmapped.push(assertion);
    }
  }

  return {
    sourcePath: source.path,
    sourceSha256: hashEvalSource(normalized),
    lines,
    unmapped,
    summary: {
      totalAssertions: assertions.length,
      mappedAssertions,
      unmappedAssertions: unmapped.length,
      passed,
      failed,
      gate,
      soft,
      totalLines: lines.length,
      annotatedLines: lines.reduce((n, l) => n + (l.assertions.length > 0 ? 1 : 0), 0),
    },
  };
}

/** 调用树的面无关投影。旧的 buildAnnotatedEvalSource 仍保留给兼容消费方。 */
export interface SourceTreeLine {
  line: number;
  text: string;
  annotations: (AssertionResult | ScoreEntry | SendAnnotation)[];
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
    | { kind: "unavailable"; file: string; calls: SourceCall[] };
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
  unmapped: { assertions: AssertionResult[]; scores: ScoreEntry[] };
  summary: { checks: number; passed: number; failed: number; unavailable: number };
}
export interface SourceContentNode extends Omit<SourceNode, "lines"> {
  lines: SourceTreeLine[];
  calls: (SourceCall & { open: boolean })[];
}
export interface SourceContent extends Omit<AnnotatedSourceTree, "spine" | "detached"> {
  spine: SourceContentNode;
  detached: SourceContentNode[];
}

/** 用 entry role 决定主干，绝不按命中数猜入口。 */
export function assembleSourceTree(input: {
  entry: SourceArtifact;
  sources: SourceArtifact[];
  assertions: AssertionResult[];
  scoreEntries: ScoreEntry[];
  sends: SendAnnotation[];
  abort?: SourceLoc;
}): AnnotatedSourceTree {
  const artifacts = new Map(input.sources.map((s) => [s.path, s]));
  artifacts.set(input.entry.path, { ...input.entry, role: "entry" });
  const nodes = new Map<string, SourceNode>();
  const node = (file: string): SourceNode | undefined => {
    const hit = nodes.get(file);
    if (hit) return hit;
    const source = artifacts.get(file);
    if (!source) return undefined;
    const body = normalizeEvalSource(source.content).replace(/\n$/, "");
    const made: SourceNode = {
      file,
      sha256: hashEvalSource(normalizeEvalSource(source.content)),
      lines: (body === "" ? [""] : body.split("\n")).map((text, i) => ({ line: i + 1, text, annotations: [], calls: [] })),
    };
    nodes.set(file, made);
    return made;
  };
  const spine = node(input.entry.path)!;
  const detached: SourceNode[] = [];
  const unmapped = { assertions: [] as AssertionResult[], scores: [] as ScoreEntry[] };
  const add = (fact: AssertionResult | ScoreEntry | SendAnnotation, loc: SourceLoc | undefined, kind: "assertion" | "score" | "send") => {
    if (!loc) {
      if (kind === "assertion") unmapped.assertions.push(fact as AssertionResult);
      if (kind === "score") unmapped.scores.push(fact as ScoreEntry);
      return;
    }
    const projectFrames = [...(loc.callers ?? []).filter((f) => f.kind === "project"), { kind: "project" as const, file: loc.file, line: loc.line, column: loc.column }];
    const spineAt = projectFrames.map((f) => f.file).lastIndexOf(spine.file);
    const anchorIndex = spineAt >= 0 ? spineAt : 0;
    const anchor = spineAt >= 0 ? spine : node(projectFrames[0]!.file);
    if (!anchor) return; // 缺源码仍由下面的 unavailable 边承载；没有可挂项目节点不伪造。
    if (spineAt < 0 && !detached.includes(anchor)) detached.push(anchor);
    let current = anchor;
    const packages = (loc.callers ?? []).filter((frame): frame is { kind: "package"; package: string } => frame.kind === "package");
    for (let i = anchorIndex + 1; i < projectFrames.length; i++) {
      const frame = projectFrames[i]!;
      const previous = projectFrames[i - 1]!;
      const line = current.lines[previous.line - 1];
      if (!line) break;
      const targetNode = node(frame.file);
      // package 段是不可展开边界，但不能吞掉包回调到项目源码的更深节点。
      if (i === anchorIndex + 1 && packages.length > 0) {
        const packageName = packages[0]!.package;
        let opaque = line.calls.find((c) => c.target.kind === "package" && c.target.package === packageName);
        if (!opaque) {
          opaque = { summary: emptySummary(), target: { kind: "package", package: packageName, calls: [] } };
          line.calls.push(opaque);
        }
        const packageTarget = opaque.target;
        if (packageTarget.kind !== "package") continue;
        const targetNode = node(frame.file);
        let nested = packageTarget.calls.find((c) => c.target.kind === "source" && c.target.node.file === frame.file);
        if (!nested) {
          nested = { summary: emptySummary(), target: targetNode ? { kind: "source", node: targetNode } : { kind: "unavailable", file: frame.file, calls: [] } };
          packageTarget.calls.push(nested);
        }
        if (nested.target.kind === "source") current = nested.target.node;
        else break;
        continue;
      }
      let call = line.calls.find((c) => c.target.kind === "source" && c.target.node.file === frame.file);
      if (!call) {
        call = { summary: emptySummary(), target: targetNode ? { kind: "source", node: targetNode } : { kind: "unavailable", file: frame.file, calls: [] } };
        line.calls.push(call);
      }
      if (call.target.kind === "source") current = call.target.node;
      else break;
    }
    const leaf = current.file === loc.file ? current.lines[loc.line - 1] : undefined;
    if (leaf) leaf.annotations.push(fact);
    else if (kind === "assertion") unmapped.assertions.push(fact as AssertionResult);
    else if (kind === "score") unmapped.scores.push(fact as ScoreEntry);
  };
  for (const a of input.assertions) add(a, a.loc, "assertion");
  for (const s of input.scoreEntries) add(s, s.loc, "score");
  for (const send of input.sends) add(send, send.loc, "send");
  const summary = summarize(spine);
  return { spine, detached, unmapped, summary };
}

/** 唯一的裁行入口；full/file/default/web 不会改变完整树或事实顺序。 */
export function projectSourceView(
  source: AnnotatedSourceTree,
  options: { mode: "default" | "full" | "file" | "web"; file?: string; budgetLines?: number },
): SourceContent {
  const project = (node: SourceNode, isSpine: boolean): SourceContentNode => {
    const selected =
      options.mode === "file" && options.file === node.file
        ? node.lines
        : node.lines.filter((line) => options.mode === "full" || line.annotations.length > 0 || line.calls.length > 0 || line.aborted);
    return {
      ...node,
      lines: selected,
      calls: selected.flatMap((line) =>
        line.calls.map((call) => ({
          ...call,
          open:
            options.mode === "full" ||
            options.mode === "web"
              ? call.summary.failed > 0 || call.summary.unavailable > 0 || call.summary.aborted
              : false,
        })),
      ),
    };
  };
  return { ...source, spine: project(source.spine, true), detached: source.detached.map((n) => project(n, false)) };
}

function emptySummary(): SourceCallSummary {
  return { checks: 0, passed: 0, failed: 0, unavailable: 0, aborted: false };
}
function summarize(node: SourceNode): { checks: number; passed: number; failed: number; unavailable: number } {
  const out = { checks: 0, passed: 0, failed: 0, unavailable: 0 };
  for (const line of node.lines) {
    for (const item of line.annotations) {
      if ("outcome" in item) {
        out.checks++;
        item.outcome === "passed" ? out.passed++ : out.failed++;
      }
    }
  }
  return out;
}
