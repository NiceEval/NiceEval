// AnnotatedEvalSource:标注 Eval 源码(定稿见 docs/concepts.md「结果数据与报告」、
// docs/concepts.md「Attempt 证据」)。把一份 eval 源码文本与该次运行产出的
// AssertionResult[] 叠在一起 —— 每条断言按 SourceLoc 标回源码行,没有(或够不上)行映射的
// 断言进 `unmapped` 桶,不静默丢弃。这是共享 model:未来的网页 CodeView 与
// `show --eval` 文本 renderer 只消费这同一份数据,不各自重新分桶。
//
// 泛化自 src/view/app/lib/transcript-data.tsx 的 indexAsserts()(Map<string, Assertion[]>
// + noloc 兜底桶的先例)——同一套"按 loc 分桶、没有 loc 进兜底"的思路,换成源码行数组
// (不是 Map)存放,外加 sourceSha256 / summary 计数。indexTurns() 那部分(events → 轮次)
// 是 ExecutionTree 的地盘,不在这个模型里。
//
// 本模块不 import react/jsx,纯数据 + 纯函数,可以在任何 Node 语境(CLI 的 show、
// view 的 server 端数据准备)调用。

import type { AssertionResult } from "../types.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";

/** 一行源码 + 映射到这一行的全部断言(保持原始顺序;可以是空数组)。 */
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
 * 纯函数:给定一份源码文本(未归一化也可以,内部会 normalizeEvalSource)与一批断言,
 * 产出标注好的 AnnotatedEvalSource。幂等 / 无 IO —— 可以在渲染路径上安全调用。
 *
 * 断言 → 源码行的映射规则:`a.loc` 存在、`a.loc.file === source.path`、且
 * `1 <= a.loc.line <= lines.length` 三者同时成立才落到对应行;否则进 `unmapped`。
 */
export function buildAnnotatedEvalSource(
  source: { path: string; content: string },
  assertions: readonly AssertionResult[],
): AnnotatedEvalSource {
  const normalized = normalizeEvalSource(source.content);
  // 末尾的单个换行符不产出幻影空行(源码文件几乎总以换行符收尾);中间的空行原样保留为一行。
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const rawLines = body.length === 0 && normalized.length === 0 ? [""] : body.split("\n");

  const lines: AnnotatedSourceLine[] = rawLines.map((text, i) => ({ line: i + 1, text, assertions: [] }));

  const unmapped: AssertionResult[] = [];
  let mappedAssertions = 0;
  let passed = 0;
  let failed = 0;
  let gate = 0;
  let soft = 0;

  for (const assertion of assertions) {
    if (assertion.passed) passed++;
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
