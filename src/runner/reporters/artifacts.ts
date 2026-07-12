// 默认本地 artifact 报告器:给 `niceeval view` 提供稳定的离线输入。
//
// 本文件是 niceeval/results 写入面(createResultsWriter)的薄壳:订阅 reporter 事件按
// experimentId 路由转手调 writer,自己不持有任何布局知识(实验目录、快照目录、attempt
// 路径清洗、大字段拆分、瘦身、版本元数据全在库内)。落盘格式见 docs/feature/results/architecture.md:
// 每个 experiment 一个实验目录,目录下按时间戳开快照,快照内每 eval-attempt 一个文件夹,
// 重数据分文件,snapshot.json 只留快照元数据,view 展开某条 trace 时再按需 fetch 它的 trace.json。

import { readFile } from "node:fs/promises";
import type { Reporter } from "../../types.ts";
import { createResultsWriter, type ResultsWriter } from "../../results/writer.ts";

/** niceeval 自身的 npm 版本,写进 producer.version;版本不匹配时读取器靠它拼 npx 提示。 */
let producerVersionPromise: Promise<string | undefined> | undefined;
function producerVersion(): Promise<string | undefined> {
  producerVersionPromise ??= readFile(new URL("../../../package.json", import.meta.url), "utf-8")
    .then((raw) => (JSON.parse(raw) as { version?: string }).version)
    .catch(() => undefined);
  return producerVersionPromise;
}

/** Artifacts 报告器额外暴露已创建的快照目录清单:CLI 在 run 结束时逐条打出给 agent 直读。 */
export type ArtifactsReporter = Reporter & { outputDirs(): { experimentId: string; dir: string }[] };

export function Artifacts(root = ".niceeval"): ArtifactsReporter {
  let writer: ResultsWriter | undefined;

  return {
    outputDirs: () => writer?.snapshotDirs() ?? [],

    async onRunStart() {
      // 每次 run 换一个新 writer(同一个 reporter 实例可能被复用):writer 内部按
      // experimentId 懒建各自的快照目录,这里只重置引用。
      writer = createResultsWriter(root, {
        producer: { name: "niceeval", version: await producerVersion() },
      });
    },

    // 每条结果一出来就按它的 experimentId 路由落盘(增量、互不影响)。fresh 条目在这里
    // 一次写成;--resume 携带合入的条目(带 artifactBase)不经这里,onRunComplete 补写。
    async onEvalComplete(result) {
      await writer?.writeAttemptFor(result);
    },

    // run 结束:先把携带条目(--resume 合入,summary.results 里带 artifactBase 的那些)
    // 逐条落盘——它们没有触发过 onEvalComplete,只会原样写 result.json,不写 artifact
    // (artifact 仍在原快照里,靠 artifactBase 懒加载回退)。再给每个快照补 completedAt。
    async onRunComplete(summary) {
      if (!writer) return;
      for (const result of summary.results) {
        if (result.artifactBase !== undefined) await writer.writeAttemptFor(result);
      }
      await writer.finish({ name: summary.name });
    },
  };
}
