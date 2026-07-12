// AttemptEvidence:一次装配一个 Attempt 的全部证据(定稿见 plan/attempt-evidence-feedback-loop.md
// 「中性数据准备」、docs/concepts.md「Attempt 证据」词条)。
//
// 这是 results/evidence 层的装配终点:locator + identity + EvalResult + AnnotatedEvalSource +
// ExecutionTree + diff + artifact 路径 + capability 位,一次算好。show、view、静态导出、报告列表
// 共用同一个 loadAttemptEvidence(attempt),不各自重读 artifact 或重算 capability——这正是
// loadAnnotatedEvalSource(attempt-source.ts)文档里说的"后续阶段的真正 assembler",这里只组合
// 已有的纯函数/薄壳,不重新实现 Eval 源码标注、ExecutionTree 合并或 diff 读取的任何一条逻辑。
//
// capability 位的门槛:每一位只在"数据真的存在且非空"时为 true,不是"artifact 文件存在"——
// 一份缺内容但存在的 diff.json(两个数组都空)与压根没有 diff.json 都不能点亮 [D]:两者对
// "有什么可看"这件事产生同一个答案(没有),只是原因不同,原因留给 unavailable 文案区分,
// 不留给 capability 位区分(capability 位只回答"要不要显示这个证据切面")。
//
//   eval      —— evalSource 非空 AND (至少有一行源码 或 至少有一条断言);理论上
//                buildAnnotatedEvalSource 对空文件也会产出一行 ""(split("\n") 的自然结果),
//                所以这条件实践中约等于"evalSource 非空",按文档口径原样写出两个子句,
//                不依赖这个实现细节。
//   execution —— events() 非空且非空数组;ExecutionTree 的骨架完全来自 events,没有事件
//                就没有骨架可看,不因为 trace 里有 span 就假装有一棵"只剩 telemetry 节点"的树
//                (那种树不是骨架,是误导——见下面 execution 字段的 null 边界)。
//   timing    —— execution 能力已经成立,且 ExecutionTree.timingAvailable 为真(spans.length > 0,
//                语义见 execution-tree.ts 的同名字段注释:代表"这次运行接入过 OTel",不代表
//                每个节点都关联上了 span——一个 agent 曾经接入过 OTel,人/agent 看到 [⏱] 才会去
//                展开找时间,这与该字段"整体是否接入过"的语义正好对应)。
//   diff      —— diff 非空 AND (generatedFiles 非空 或 deletedFiles 非空);空判定与
//                show/render.ts::diffText 的既有口径(generated.length===0 && deleted.length===0
//                时打印"no file changes recorded")完全一致,不另立一套空判定。

import { join } from "node:path";
import type { AttemptHandle } from "./types.ts";
import { type AttemptIdentity, type AttemptLocator, encodeAttemptLocator } from "./locator.ts";
import { loadAnnotatedEvalSource } from "./attempt-source.ts";
import type { AnnotatedEvalSource } from "./annotated-source.ts";
import { buildExecutionTree, type ExecutionTree } from "../o11y/execution-tree.ts";
import type { DiffData, EvalResult } from "../types.ts";

/**
 * 一个 Attempt 的 artifact 落盘位置。单一目录足够:一个 attempt 的全部 artifact
 * (events.json / trace.json / o11y.json / diff.json / sources.json,见 ARTIFACT_KINDS)
 * 要么全在它自己的 attempt 目录,要么(--resume 携带条目——本轮没写任何新数据,
 * 见 writer.ts 对携带分支的说明)全在 artifactBase 回退到的原快照 attempt 目录,
 * 从不出现"这个 kind 在自己目录、那个 kind 在 artifactBase"的拆分场景,不需要
 * 按 kind 逐个给路径。想要某一种 artifact 的具体文件,自己拼
 * `join(artifactPaths.dir, "<kind>.json")`(kind 见 `ArtifactKind`)。
 *
 * 与 show/render.ts 的 `attemptArtifactsPath(attempt, cwd)` 是同一份"这个 attempt 的证据在哪"
 * 知识的两种呈现:那边为 CLI 文本展示把它转成 cwd 相对的短路径,这里给 evidence 层的调用方
 * (view / 静态导出 / 报告列表,它们没有统一的"cwd"概念)一份绝对路径,不做相对化。
 */
export interface EvidencePaths {
  /** 绝对路径。 */
  dir: string;
}

/**
 * 每一位只在数据真的存在且非空时为 true——从不因为对应的 artifact 文件"存在"就点亮,
 * 见本文件头注逐位的门槛说明。show/view/静态导出/报告列表读这四位来决定要不要显示
 * 对应的证据切面,不自己重新判断"这个 attempt 有没有 X"。
 */
export interface AttemptEvidenceCapabilities {
  /** evalSource 非空且有内容(源码行或断言二选一非空)。 */
  eval: boolean;
  /** events 非空数组——有骨架可看。 */
  execution: boolean;
  /** execution 成立且这次运行接入过 OTel(ExecutionTree.timingAvailable)。 */
  timing: boolean;
  /** diff 非空且至少改动/删除了一个文件。 */
  diff: boolean;
}

/**
 * 一个 Attempt 的完整证据聚合。除 `locator` 外每个字段要么是别的模块已经产出的纯数据类型,
 * 要么是这四样拼出来的判定——本类型自己不发明新的证据形状。
 */
export interface AttemptEvidence {
  locator: AttemptLocator;
  /** locator 派生自的不可变身份元组,与 `locator` 编码的是同一份数据,供不想解码 locator
   * 的调用方直接读结构化字段(如按 experimentId 分组、按时间排序)。 */
  identity: AttemptIdentity;
  result: EvalResult;
  /** 运行时保存的 Eval 源码标注(`--eval` 切面);没有 sources() 就是 null,不伪造空文档。 */
  evalSource: AnnotatedEvalSource | null;
  /** 标准事件流 + OTel enrichment(`--execution` 切面);没有非空 events 就是 null,
   * 不产出一棵只剩 telemetry-only 节点、没有真实骨架的误导性树(见头注 execution 门槛)。 */
  execution: ExecutionTree | null;
  /** 被测 Agent 对 Sandbox 工作区的文件变化(`--diff` 切面);原样透传 attempt.diff()。 */
  diff: DiffData | null;
  artifactPaths: EvidencePaths;
  capabilities: AttemptEvidenceCapabilities;
}

/**
 * 纯组合:一次性 await 好 attempt 的四类懒加载证据(events / trace / diff / 经
 * loadAnnotatedEvalSource 解引用的 eval 源码),拼成一份 AttemptEvidence。不重新实现
 * Eval 源码标注、ExecutionTree 合并或 diff 语义的任何一条规则——那些规则的家分别在
 * annotated-source.ts / execution-tree.ts / attempt.diff() 自身,这里只调用与判定"够不够
 * 亮起对应的证据切面"。
 *
 * `attempt.locator` 在真实读取路径(openResults() 产出的 handle)恒有值;缺失时按当前身份
 * 元组按 encodeAttemptLocator 兜底算一份,同 open.ts 给 record.locator 做的兜底同一口径——
 * 只服务手工构造 AttemptHandle 的测试场景,不改变真实读取路径的行为。
 */
export async function loadAttemptEvidence(attempt: AttemptHandle): Promise<AttemptEvidence> {
  const identity: AttemptIdentity = {
    experimentId: attempt.experimentId,
    snapshotStartedAt: attempt.snapshot.startedAt,
    evalId: attempt.evalId,
    attempt: attempt.result.attempt,
  };
  const locator = attempt.locator ?? encodeAttemptLocator(identity);

  const [evalSource, events, trace, diff] = await Promise.all([
    loadAnnotatedEvalSource(attempt),
    attempt.events(),
    attempt.trace(),
    attempt.diff(),
  ]);

  // execution 的 null 边界:没有非空事件骨架就是 null,即使 trace 里有 span(那些 span 在
  // buildExecutionTree 里只会全部落进 telemetry-only 桶,产出一棵没有骨架、只有遥测的树——
  // 那不是"这个 attempt 的执行记录",是噪音,不比 null 更有用)。
  const hasEvents = events !== null && events.length > 0;
  const execution = hasEvents ? buildExecutionTree(events, trace ?? []) : null;

  const evalCapable = evalSource !== null && (evalSource.lines.length > 0 || evalSource.summary.totalAssertions > 0);
  // 与 show/render.ts::diffText 的既有空判定同一口径:generatedFiles 与 deletedFiles 都空
  // 才算"没有变化"。
  const diffCapable = diff !== null && (Object.keys(diff.generatedFiles).length > 0 || diff.deletedFiles.length > 0);

  return {
    locator,
    identity,
    result: attempt.result,
    evalSource,
    execution,
    diff,
    artifactPaths: { dir: attemptArtifactDir(attempt) },
    capabilities: {
      eval: evalCapable,
      execution: execution !== null,
      timing: execution !== null && execution.timingAvailable,
      diff: diffCapable,
    },
  };
}

/**
 * attempt artifact 目录的绝对路径:与 show/render.ts::attemptArtifactsPath 同一条判定
 * (本 attempt 目录,或 --resume 携带条目回退到的 artifactBase 目录),只是不做 cwd 相对化
 * ——evidence 层没有统一的"当前工作目录"概念,相对化是 CLI 文本渲染层自己的事。
 */
function attemptArtifactDir(attempt: AttemptHandle): string {
  const r = attempt.result;
  return r.artifactBase
    ? join(attempt.snapshot.dir, "..", "..", r.artifactBase)
    : join(attempt.snapshot.dir, attempt.ref.attempt);
}
