// 本地结果查看器入口:只做编排与对外导出。
// 站点管线(planSite/writeSite,server 与 --out 的唯一联系面)在 site.ts,读取(openResults)
// 与统计(官方计算函数)在 data.ts,HTTP 宿主在 server.ts,server/前端共用的数据契约在
// shared/types.ts。

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ViewInputError } from "./data.ts";
import { planSite, writeSite } from "./site.ts";
import type { ViewOptions } from "./server.ts";

export { startViewServer, type ViewOptions, type ViewServer } from "./server.ts";
export { planSite, writeSite, renderHtml, renderStandaloneAttemptDocument, type SitePlan, type SiteFile } from "./site.ts";
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
 * 导出静态报告(--out):只有目录式一种形态。站点管线(site.ts)产出与本地 server 服务的
 * 同一份产物清单,这里把它写进 <dir>——index.html + `artifact/<base>/` 证据树,整个目录扔给
 * 任何静态托管即是完整体验。首页即报告槽(裸跑填充内建报告,--report 整槽替换),证据室同站;
 * 多页报告仍是单个 index.html(页面走 `#/page/<id>` 路由)。单文件(*.html)导出已移除:
 * 代码/transcript/trace 视图依赖 artifact 文件,单文件注定残缺(docs/feature/reports/view.md
 * 「静态导出」)。
 */
export async function buildView(opts: ViewOptions = {}): Promise<string> {
  const out = resolve(opts.out ?? ".niceeval/site");
  if (/\.html?$/i.test(out)) {
    throw new Error(
      `--out expects a directory, got "${opts.out}". Single-file HTML export was removed: code, transcript and trace views need artifact files next to the page. Export a directory instead (e.g. --out site) and serve it with any static host.`,
    );
  }
  // 位置参数 / --exp 对导出同义于本地:收窄作用在有效根上,出站的页面数据与证据文件
  // 只含收窄后的范围(docs/feature/reports/view.md「静态导出」:出站的就是收窄到的)。
  // 静态导出保持「任一页失败整体失败」(pageFailure 缺省 "throw"),不产出半套站点。
  const plan = await planSite(opts.input, opts.scan);
  await writeSite(plan, out);
  return out;
}
