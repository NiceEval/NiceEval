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
 * view 的位置参数语义(与 CLI 模型一致:位置参数选「看哪些 eval」):
 * - 恰好一个位置参数且指向存在的文件 → 单文件模式(`niceeval view <summary.json>`),
 *   不与 --run 或其它位置参数混用;
 * - 指向存在的目录 → 报错直说:目录经 `--run <dir>` 递入,位置参数留给 eval id 前缀;
 * - 其余 → eval id 前缀,收窄报告槽 Selection(经 show 同一套 Selection 合成)。
 */
export function resolveViewInput(
  cwd: string,
  positionals: string[],
  run?: string,
): { input?: string; patterns: string[] } {
  if (run !== undefined) {
    const dir = resolve(cwd, run);
    if (!existsSync(dir)) {
      throw new ViewInputError(`Results directory not found: ${dir}`);
    }
  }
  const kindOf = (p: string): "file" | "dir" | "pattern" => {
    try {
      const stat = statSync(resolve(cwd, p));
      return stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "pattern";
    } catch {
      return "pattern";
    }
  };
  for (const p of positionals) {
    const kind = kindOf(p);
    if (kind === "dir") {
      throw new ViewInputError(
        `"${p}" is a directory. Pass results directories with --run (niceeval view --run ${p}); positional arguments select evals by id prefix.`,
      );
    }
    if (kind !== "file") continue;
    if (positionals.length > 1) {
      throw new ViewInputError(
        `"${p}" is a summary file, but more positional arguments were given. Single-file mode takes exactly one path: niceeval view ${p}`,
      );
    }
    if (run !== undefined) {
      throw new ViewInputError(
        `"${p}" is a summary file and cannot be combined with --run. Pass either the file (niceeval view ${p}) or the results dir (niceeval view --run <dir>).`,
      );
    }
    return { input: resolve(cwd, p), patterns: [] };
  }
  return {
    ...(run !== undefined ? { input: resolve(cwd, run) } : {}),
    patterns: positionals,
  };
}

/**
 * 导出静态报告(--out):只有目录式一种形态。写 <dir>/index.html,并把前端会 fetch 的 artifact
 * (sources.json / events.json / trace.json)复制到 <dir>/artifact/<base>/——与本地
 * server 的 /artifact/<rel> 路由同一布局,整个目录扔给任何静态托管即是完整体验。
 * 首页即报告槽(裸跑填充 CostPassRateComparison,--report 整槽替换),证据室同站。
 * 单文件(*.html)导出已移除:代码/transcript/trace 视图依赖 artifact 文件,单文件注定残缺,
 * 存在本身就在诱导用户导出一份看不了证据的报告(docs/feature/reports/view.md「静态导出」)。
 */
export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const out = resolve(opts.out ?? ".niceeval/site");
  if (/\.html?$/i.test(out)) {
    throw new Error(
      `--out expects a directory, got "${opts.out}". Single-file HTML export was removed: code, transcript and trace views need artifact files next to the page. Export a directory instead (e.g. --out site) and serve it with any static host.`,
    );
  }
  const scan = await loadViewScan(opts.input, opts.scan);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.html"), await renderHtml(scan), "utf-8");
  await copyFetchedArtifacts(scan, join(out, "artifact"));
  return out;
}

// 只导出前端会 fetch 的三类 artifact。diff.json / o11y.json 是运行侧产物,查看器从不读取,
// 且 diff 可达上百 MB,带进静态导出只会拖垮部署体积。events.json / trace.json 原字节复制;
// sources.json 是例外——盘上是去重后的引用(`{path, sha256}[]`),必须先经
// AttemptHandle.sources() 解引用出完整内容(`{path, content}[]`)再写出,否则浏览器端的
// isCodeSource 守卫因缺 content 字段判空,代码视图会误判「源码未捕获」(即便源码明明捕获了)。
const RAW_COPY_ARTIFACTS = ["events.json", "trace.json"];

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
