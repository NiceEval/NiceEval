// 薄组合层:给一个 AttemptHandle,把它的(已去重存储、经 sources() 解引用回来的)eval 源码
// 与它的 EvalResult.assertions 叠成 AnnotatedEvalSource(annotated-source.ts 的纯函数)。
//
// 这不是 AttemptEvidence assembler(那是后续阶段——统一 locator + AnnotatedEvalSource +
// ExecutionTree + diff 的中性证据聚合)。这里只证明一件事:discovery 时捕获 → 写入面按快照
// 去重存储 → 读取面经 attempt.sources() 解引用取回 → buildAnnotatedEvalSource 标注,这条链路
// 端到端能跑通,供后续阶段(text `--eval` renderer、web CodeView、真正的 assembler)直接调用
// 或参照。

import type { AttemptHandle } from "./types.ts";
import {
  assembleSourceTree,
  buildAnnotatedEvalSource,
  type AnnotatedEvalSource,
  type AnnotatedSourceTree,
  type SendAnnotation,
} from "./annotated-source.ts";

/**
 * 给定一个 attempt,取回它的 eval 源码(经 sources() 解引用,可能来自本快照或
 * artifactBase 回退到的原快照)与它的断言,产出标注好的 AnnotatedEvalSource。
 *
 * 没有 sources()(eval 从没被 `loc` 引用到、或落盘里压根没有 sources.json/artifactBase
 * 已失效)时返回 null——没有源码就没有「标注源码」这回事,不伪造一份空文档。
 *
 * 一个 attempt 的 sources() 理论上可以有多份文件(主 eval 文件 + 罕见的跨文件 loc);
 * 这里按「哪份文件被最多断言的 loc 命中」选一份作为主文件喂给 buildAnnotatedEvalSource——
 * 只服务这条打通链路的验证目的,不是最终选择策略(后续阶段如需要为每份引用到的文件
 * 都出一份 AnnotatedEvalSource,在这基础上很容易扩成返回数组)。
 */
export async function loadAnnotatedEvalSource(
  attempt: AttemptHandle,
  sends: readonly SendAnnotation[] = [],
): Promise<AnnotatedEvalSource | null> {
  const sources = await attempt.sources();
  if (!sources || sources.length === 0) return null;

  const assertions = attempt.result.assertions;
  let primary = sources[0]!;
  if (sources.length > 1) {
    const hits = new Map<string, number>();
    for (const a of assertions) {
      if (!a.loc) continue;
      hits.set(a.loc.file, (hits.get(a.loc.file) ?? 0) + 1);
    }
    let best = -1;
    for (const s of sources) {
      const count = hits.get(s.path) ?? 0;
      if (count > best) {
        best = count;
        primary = s;
      }
    }
  }

  return buildAnnotatedEvalSource(primary, assertions, sends);
}

/** AttemptSource 与计分明细共用同一棵证据树，而非各自按 loc 再分桶。 */
export async function loadAttemptSourceTree(
  attempt: AttemptHandle,
  sends: readonly SendAnnotation[] = [],
): Promise<AnnotatedSourceTree | null> {
  const sources = await attempt.sources();
  if (!sources?.length) return null;
  const entry = sources.find((source) => source.role === "entry");
  if (!entry) return null;
  return assembleSourceTree({
    entry,
    sources,
    assertions: attempt.result.assertions,
    scoreEntries: attempt.result.scoreEntries ?? [],
    sends: [...sends],
  });
}
