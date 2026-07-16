// 本地结果查看器入口:只做编排与对外导出。
// 读取(openResults)与统计(官方计算函数)在 data.ts,HTTP 与 HTML 烘焙在 server.ts,
// server/前端共用的数据契约在 shared/types.ts。

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ViewInputError, loadViewScan, type ViewScan } from "./data.ts";
import { renderHtml, type ViewOptions } from "./server.ts";

export { startViewServer, type ViewOptions, type ViewServer } from "./server.ts";
export {
  IncompatibleResultsError,
  ViewInputError,
  incompatibleHint,
  incompatibleViewCommand,
  loadLatestResultsPerEval,
  loadViewScan,
  type IncompatibleRun,
  type ViewScan,
  type ViewScanOptions,
} from "./data.ts";

/**
 * view 的输入语义(docs/feature/reports/view.md「打开与收窄」):位置参数只有一种含义——
 * eval id 前缀,与 show 一致,含义不随文件系统状态改变(路径样子的位置参数只会按前缀报无匹配)。
 * 结果根经 `--results <dir>` 递入;单开一份快照经 `--snapshot <file>` 递入,文件不可读时
 * 命令失败(扫描模式对坏快照只跳过)。两个来源互斥。
 */
export function resolveViewInput(
  cwd: string,
  positionals: string[],
  opts: { results?: string; snapshot?: string } = {},
): { input?: string; patterns: string[] } {
  const { results, snapshot } = opts;
  if (results !== undefined && snapshot !== undefined) {
    throw new ViewInputError(
      "--results and --snapshot are mutually exclusive: --results scans a results root, --snapshot opens exactly one snapshot file.",
    );
  }
  if (results !== undefined) {
    const dir = resolve(cwd, results);
    if (!existsSync(dir)) {
      throw new ViewInputError(`Results directory not found: ${dir}`);
    }
    return { input: dir, patterns: positionals };
  }
  if (snapshot !== undefined) {
    const file = resolve(cwd, snapshot);
    let isFile = false;
    try {
      isFile = statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      throw new ViewInputError(
        `--snapshot expects a readable snapshot file, got: ${file}. Pass the snapshot.json of one run, or scan a results root with --results <dir>.`,
      );
    }
    return { input: file, patterns: positionals };
  }
  return { patterns: positionals };
}

/**
 * 导出静态报告(--out):只有目录式一种形态。写 <dir>/index.html,并把前端会 fetch 的 artifact
 * (sources.json / events.json / trace.json / diff.json)复制到 <dir>/artifact/<base>/——与本地
 * server 的 /artifact/<rel> 路由同一布局,整个目录扔给任何静态托管即是完整体验。
 * 首页即报告槽(裸跑填充内建报告,--report 整槽替换),证据室同站;多页报告仍是单个
 * index.html(页面走 `#/page/<id>` 路由)。单文件(*.html)导出已移除:代码/transcript/trace
 * 视图依赖 artifact 文件,单文件注定残缺(docs/feature/reports/view.md「静态导出」)。
 */
export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const out = resolve(opts.out ?? ".niceeval/site");
  if (/\.html?$/i.test(out)) {
    throw new Error(
      `--out expects a directory, got "${opts.out}". Single-file HTML export was removed: code, transcript and trace views need artifact files next to the page. Export a directory instead (e.g. --out site) and serve it with any static host.`,
    );
  }
  // --out 与位置参数 / --experiment 互斥(docs/feature/reports/view.md「静态导出」):报告槽收窄
  // 只影响报告,证据室恒随根完整——允许同用会让发布者误以为站点只含该实验,实际根里全部
  // attempt 的证据都已出站。按实验收窄发布 = 用 copySnapshots 构建只含它的发布根,再对新根导出。
  if ((opts.scan?.patterns?.length ?? 0) > 0 || opts.scan?.experiment !== undefined) {
    throw new ViewInputError(
      "--out exports the whole results root and cannot be combined with eval prefixes or --experiment.\n" +
        "To publish a site for one experiment, build a narrower results root and export that:\n" +
        '  const results = await openResults(".niceeval");\n' +
        '  await copySnapshots(results.latest().filter((s) => s.experimentId.startsWith("<prefix>/")), "<publish-root>", { redact });\n' +
        "Then: niceeval view --results <publish-root> --out <site>",
    );
  }
  const scan = await loadViewScan(opts.input, opts.scan);
  // --out 按发布防呆二分(见 docs/feature/reports/view.md「静态导出」):目标结果根的全部快照
  // 带 publish:{redaction:"applied"}(copySnapshots 补记)时直接导出;redaction:"none"、
  // 无标记结果或本地事实根,都必须显式传 --allow-sensitive-artifacts——静态站原样携带证据文件,
  // 上游声明过原文发布也不豁免这里的确认。
  if (!opts.allowSensitiveArtifacts && scan.publishState !== "applied") {
    throw new ViewInputError(
      `--out refuses to export unredacted results: not every selected snapshot carries publish: { redaction: "applied" }. ` +
        `Produce a publish root first with copySnapshots({ redact }) and export that (niceeval view --results <publish-root> --out <site>), ` +
        `or pass --allow-sensitive-artifacts to explicitly export raw evidence (prompts, tool args, full outputs, sources).`,
    );
  }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.html"), await renderHtml(scan), "utf-8");
  await copyFetchedArtifacts(scan, join(out, "artifact"));
  return out;
}

// 导出没有档位(docs/feature/reports/view.md「静态导出」):结果根里存在且前端会读取的证据
// 文件全部复制——events.json / trace.json / diff.json 原字节复制(diff 有就带,缺时前端在
// 证据位置如实显示缺失;体积取舍在构建发布根时用 copySnapshots({ artifacts }) 做,不在导出层);
// 唯一永不复制的是 o11y.json——报告数字在导出时已烘进 HTML,浏览器不读它。
// sources.json 是格式例外——盘上是去重后的引用(`{path, sha256}[]`),必须先经
// AttemptHandle.sources() 解引用出完整内容(`{path, content}[]`)再写出,否则浏览器端的
// isCodeSource 守卫因缺 content 字段判空,代码视图会误判「源码未捕获」(即便源码明明捕获了)。
const RAW_COPY_ARTIFACTS = ["events.json", "trace.json", "diff.json"];

async function copyFetchedArtifacts(scan: ViewScan, artifactRoot: string): Promise<void> {
  for (const [base, srcDir] of scan.artifactDirs) {
    const destDir = join(artifactRoot, base);
    // 输入本身已经是导出布局(比如对着上次导出的目录重新生成 index.html)时不自拷。
    if (resolve(srcDir) === resolve(destDir)) continue;

    const rawFiles = RAW_COPY_ARTIFACTS.filter((name) => existsSync(join(srcDir, name)));
    const hasSourcesRef = existsSync(join(srcDir, "sources.json"));
    if (!rawFiles.length && !hasSourcesRef) continue;

    await mkdir(destDir, { recursive: true });
    await Promise.all(rawFiles.map((name) => copyFile(join(srcDir, name), join(destDir, name))));

    if (hasSourcesRef) {
      const attempt = scan.attemptsByBase.get(base);
      const sources = attempt ? await attempt.sources() : null;
      await writeFile(join(destDir, "sources.json"), JSON.stringify(sources ?? []), "utf-8");
    }
  }
}
