// 默认本地工件报告器:给 `niceeval view` 提供稳定的离线输入。
//
// 布局(每 eval-attempt 一个文件夹,重数据分文件;summary.json 只留榜单元数据):
//   .niceeval/<run>/
//     summary.json                         # run 元数据 + 各 result 的判决/usage/断言/引用(瘦身)
//     <evalId>/<agent>/<model>/a<attempt>/
//       events.json  sources.json  trace.json  o11y.json  diff.json
// view 读 summary.json 渲染榜单,展开某条 trace 时再按需 fetch 它的 trace.json。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type Reporter, type RunSummary } from "../../types.ts";

/** niceeval 自身的 npm 版本,写进 producer.version;版本不匹配时读取器靠它拼 npx 提示。 */
let producerVersionPromise: Promise<string | undefined> | undefined;
function producerVersion(): Promise<string | undefined> {
  producerVersionPromise ??= readFile(new URL("../../../package.json", import.meta.url), "utf-8")
    .then((raw) => (JSON.parse(raw) as { version?: string }).version)
    .catch(() => undefined);
  return producerVersionPromise;
}

/** 一个 attempt 的工件子目录(相对 run 根):<evalId>/<agent>/<model>/a<attempt>。 */
function attemptDir(r: EvalResult): string {
  const safe = (s: string) => s.replace(/[^\w.@-]/g, "_");
  // evalId 里的 / 保留作目录层级,其余危险字符替换。
  const id = r.id.replace(/[^\w./@-]/g, "_");
  return `${id}/${safe(r.agent)}/${safe(r.model ?? "default")}/a${r.attempt}`;
}

/** summary.json 用的瘦身结果:去掉大数组(events/trace/o11y/diff/sources),换成目录引用 + 存在标记。 */
function slimResult(r: EvalResult): EvalResult {
  const { events, sources, o11y, trace, diff, rawTranscript, ...rest } = r;
  void events;
  void sources;
  void o11y;
  void trace;
  void diff;
  void rawTranscript;
  // 携带结果(跨实验复用上次 pass,见 run.ts 的 carriedResults):本轮没有任何新数据,
  // rest 上已经带着 artifactBase 指向旧 run 的产物目录,hasSources/hasEvents/hasTrace
  // 也是从旧 summary 带过来的真值——不能因为"这轮没数据"就重新推导成 false / 编出一个
  // 这轮压根没写过文件的新 artifactsDir(会让 artifactBase 在下次 withViewRefs 时被覆盖)。
  if (rest.artifactBase) return rest;
  return {
    ...rest,
    artifactsDir: attemptDir(r),
    hasTrace: !!(trace && trace.length),
    hasEvents: !!(events && events.length),
    hasSources: !!(sources && sources.length),
  };
}

/** Artifacts 报告器额外暴露输出目录:CLI 在 run 结束时打出 summary.json 路径给 agent 直读。 */
export type ArtifactsReporter = Reporter & { outputDir(): string };

export function Artifacts(root = ".niceeval"): ArtifactsReporter {
  let outputDir = "";
  const ensureDir = async (): Promise<void> => {
    if (!outputDir) outputDir = join(root, safeTimestamp(new Date()));
    await mkdir(outputDir, { recursive: true });
  };

  return {
    outputDir: () => outputDir,

    async onRunStart() {
      outputDir = join(root, safeTimestamp(new Date()));
      await mkdir(outputDir, { recursive: true });
    },

    // 每条结果一出来就把它的重数据落到自己的文件夹(增量、互不影响)。
    async onEvalComplete(result) {
      await ensureDir();
      const dir = join(outputDir, attemptDir(result));
      await mkdir(dir, { recursive: true });
      const writes: Promise<unknown>[] = [];
      if (result.events?.length)
        writes.push(writeFile(join(dir, "events.json"), JSON.stringify(result.events), "utf-8"));
      if (result.sources?.length)
        writes.push(writeFile(join(dir, "sources.json"), JSON.stringify(result.sources), "utf-8"));
      if (result.trace?.length)
        writes.push(writeFile(join(dir, "trace.json"), JSON.stringify(result.trace), "utf-8"));
      if (result.o11y) writes.push(writeFile(join(dir, "o11y.json"), JSON.stringify(result.o11y), "utf-8"));
      if (result.diff) writes.push(writeFile(join(dir, "diff.json"), JSON.stringify(result.diff), "utf-8"));
      await Promise.all(writes);
    },

    // run 结束写瘦身 summary.json(版本元数据 + 榜单要的字段 + 工件引用)。
    async onRunComplete(summary) {
      await ensureDir();
      const slim: RunSummary = {
        format: RESULTS_FORMAT,
        schemaVersion: RESULTS_SCHEMA_VERSION,
        producer: { name: "niceeval", version: await producerVersion() },
        ...summary,
        outputDir,
        results: summary.results.map(slimResult),
      };
      await writeFile(join(outputDir, "summary.json"), JSON.stringify(slim, null, 2), "utf-8");
    },
  };
}

function safeTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
