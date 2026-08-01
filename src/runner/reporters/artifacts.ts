// 默认本地 artifact 报告器:给 `niceeval view` 提供稳定的离线输入。
//
// 本文件是 niceeval/record 写入面(createWriter)的薄壳:订阅 reporter 事件按
// experimentId 路由转手调 writer,自己不持有任何布局知识(实验目录、快照目录、attempt
// 路径清洗、大字段拆分、瘦身、版本元数据全在库内)。落盘格式见 docs/feature/record/architecture.md:
// 每个 experiment 一个实验目录,目录下按时间戳开快照,快照内每 eval-attempt 一个文件夹,
// 重数据分文件,run.json 只留快照元数据,view 展开某条 trace 时再按需 fetch 它的 trace.json。

import { readFile } from "node:fs/promises";
import type { InvocationShape, Reporter, ReporterEvent } from "../../types.ts";
import { createWriter, type Writer } from "../../record/writer.ts";

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
  let writer: Writer | undefined;
  // 已经通过 experiment:complete 封口过的 experimentId——onInvocationComplete 的兜底不重复封它们。
  const finishedByEvent = new Set<string>();

  return {
    outputDirs: () => writer?.snapshotDirs() ?? [],

    async onInvocationStart(_evals, shape?: InvocationShape) {
      // 每次 run 换一个新 writer(同一个 reporter 实例可能被复用):writer 内部按
      // experimentId 懒建各自的快照目录,这里只重置引用。
      // snapshotStartedAt 显式接收自 runner(shape.snapshotStartedAt,见 InvocationShape 的注释)——
      // 不再各自按「该 experiment 第一条落盘 result 的 attempt startedAt」猜,与 runner
      // 在 result.locator 里编码的身份锚点是同一个值。省略只出现在没有真实 shape 的
      // 直调场景(如测试手写 Reporter 调用),此时退回 createWriter 自己的兜底
      // (result.startedAt,见 writer.ts 的 WriterOptions.snapshotStartedAt)。
      writer = createWriter(root, {
        producer: { name: "niceeval", version: await producerVersion() },
        snapshotStartedAt: shape?.snapshotStartedAt,
        // 指纹输入清单同样由 runner 显式递来(规划期算出),writer 在建 Run 目录时与
        // run.json 同批写出;这里只转手,不持有清单怎么算的知识。
        ...(shape?.manifests ? { manifests: shape.manifests } : {}),
      });
      finishedByEvent.clear();
    },

    // 每条结果一出来就按它的 experimentId 路由落盘(增量、互不影响)。fresh 条目在这里
    // 一次写成;--resume 携带合入的条目(带 artifactBase)不经这里,由 experiment:complete
    // 携带的 carriedResults(或兜底的 onInvocationComplete)补写。
    async onEvalComplete(result) {
      await writer?.writeAttemptFor(result);
    },

    // Experiment 收尾协议(docs/runner.md):每个 experiment:complete 各自对应一个 Run 的
    // 一次原子封口——携带的 carriedResults 先补写(它们没有触发过 onEvalComplete),再用事件
    // 自带的 completedAt 与 diagnostics 调用该 Run 自己的 finish()。跨 Experiment 的
    // Invocation 级事实(interrupted、reporter error)不走这条事件,不会误落进任一 Run。
    async onEvent(event: ReporterEvent) {
      if (event.type !== "experiment:complete" || !writer) return;
      for (const result of event.carriedResults) {
        if (result.artifactBase !== undefined) await writer.writeAttemptFor(result);
      }
      const runs = await writer.snapshotWriters();
      const target = runs.find((s) => s.experimentId === event.experimentId);
      if (!target) return; // 该 experimentId 从未真正落过任何 attempt,没有 Run 可封
      finishedByEvent.add(event.experimentId);
      await target.writer.finish({
        completedAt: event.completedAt,
        diagnostics: [...event.diagnostics],
        ...(event.facts ? { facts: { ...event.facts } } : {}),
        ...(event.timings?.length ? { timings: [...event.timings] } : {}),
        ...(event.sandboxBuilds?.length ? { sandboxBuilds: [...event.sandboxBuilds] } : {}),
        ...(event.stateWindows?.length ? { stateWindows: [...event.stateWindows] } : {}),
        name: event.name,
      });
    },

    // 兜底:任何没有经 experiment:complete 走到封口的 Run 在这里补齐(如没有 experimentId
    // 的直调测试场景、或第三方手写 Reporter 调用绕开了 runner 的事件流)——保证不留下永远停在
    // 「未收尾」状态的 Run。先补写携带条目(summary.results 里带 artifactBase 的那些)。
    async onInvocationComplete(summary) {
      if (!writer) return;
      for (const result of summary.results) {
        if (result.artifactBase !== undefined) await writer.writeAttemptFor(result);
      }
      const runs = await writer.snapshotWriters();
      await Promise.all(
        runs
          .filter(({ experimentId }) => !finishedByEvent.has(experimentId))
          .map(({ writer: snap }) => snap.finish({ name: summary.name })),
      );
    },
  };
}
