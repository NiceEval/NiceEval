// cases: docs/engineering/testing/unit/reports.md
// 「renderer 资产进入站点管线」：报告块标签与 SitePlan.files 必须在同一条调用里产生。

import { describe, expect, it, vi } from "vitest";

import type { PageRendererAssets } from "../report/extension/types.ts";
import type { ViewScan } from "./data.ts";
import { renderSiteReportBlock, type SitePlan } from "./site.ts";

function fixture(): { plan: SitePlan; assets: PageRendererAssets } {
  const css = new TextEncoder().encode(".matrix{display:grid}");
  const js = new TextEncoder().encode("globalThis.__matrixEnhanced=true");
  const assets: PageRendererAssets = {
    styles: [
      {
        hash: "a".repeat(64),
        ext: ".css",
        path: `assets/${"a".repeat(64)}.css`,
        kind: "style",
        content: css,
      },
    ],
    scripts: [
      {
        hash: "b".repeat(64),
        ext: ".js",
        path: `assets/${"b".repeat(64)}.js`,
        kind: "script",
        content: js,
      },
    ],
  };
  const render = vi.fn(async () => '<div class="matrix">ok</div>');
  const scan = {
    reportPages: {
      ids: ["report"],
      render,
      assets: vi.fn(async () => assets),
    },
  } as unknown as ViewScan;
  return {
    assets,
    plan: {
      files: new Map(),
      scan,
      shellFingerprint: "fixture",
    },
  };
}

describe("renderer 资产进入站点管线", () => {
  it("报告块声明 hash 资产，CSS/JS 同步登记到 SitePlan.files；多 locale 不重复", async () => {
    const { plan, assets } = fixture();
    const en = await renderSiteReportBlock(plan, "report", "en");
    const zh = await renderSiteReportBlock(plan, "report", "zh-CN");

    expect(en).toContain(`data-niceeval-renderer-asset="style:${assets.styles[0]!.hash}"`);
    expect(en).toContain(`href="${assets.styles[0]!.path}"`);
    expect(en).toContain(`data-niceeval-renderer-asset="script:${assets.scripts[0]!.hash}"`);
    expect(en).toContain(`src="${assets.scripts[0]!.path}"`);
    expect(zh).toContain('<div class="matrix">ok</div>');
    expect([...plan.files.keys()].sort()).toEqual(
      [assets.styles[0]!.path, assets.scripts[0]!.path].sort(),
    );
    expect(plan.files.get(assets.styles[0]!.path)?.contentType).toBe("text/css; charset=utf-8");
    expect(plan.files.get(assets.scripts[0]!.path)?.contentType).toBe("text/javascript; charset=utf-8");
  });
});
