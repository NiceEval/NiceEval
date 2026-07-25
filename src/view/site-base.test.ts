// cases: docs/engineering/testing/unit/reports.md
// 覆盖登记行(「站点根归一(index.html 的 <base> 引导脚本)」类别):导出产物里那段引导脚本对
// location.pathname 的站点根判定——无尾斜杠索引路径、已是目录形态、末段带扩展名三格。
// 断言面是脚本落下的 base.href,不是整页 HTML(整页结构归 e2e/report.md)。
// bug: memory/static-export-breaks-on-slashless-index-url.md

import { describe, expect, it } from "vitest";

import { SITE_BASE_SCRIPT } from "./site.ts";

/**
 * 把导出产物里的同一份脚本原样喂给假的浏览器宿主(script 里 location / document 是自由变量),
 * 返回它挂进 head 的 <base> 的 href;没挂返回 null。不复制第二份判定逻辑。
 */
function baseHrefFor(pathname: string): string | null {
  const attached: { href?: string }[] = [];
  const doc = {
    createElement: (tag: string) => {
      if (tag !== "base") throw new Error(`unexpected element: ${tag}`);
      return {} as { href?: string };
    },
    head: {
      appendChild: (el: { href?: string }) => {
        attached.push(el);
      },
    },
  };
  new Function("location", "document", SITE_BASE_SCRIPT)({ pathname }, doc);
  return attached.length === 0 ? null : (attached[0]!.href ?? null);
}

describe("站点根归一引导脚本", () => {
  it("无尾斜杠的索引路径(cleanUrls 托管)按站点根补出目录形态", () => {
    // 这一格是唯一有区分力的输入:不补时 `attempt/<locator>.html` 会解析到 /showcase/。
    expect(baseHrefFor("/showcase/memory")).toBe("/showcase/memory/");
    expect(baseHrefFor("/report")).toBe("/report/");
  });

  it("路径已是目录形态时不插入 <base>", () => {
    expect(baseHrefFor("/")).toBeNull();
    expect(baseHrefFor("/showcase/memory/")).toBeNull();
  });

  it("末段带扩展名(直接指到文件)时按其目录取根", () => {
    expect(baseHrefFor("/out/index.html")).toBe("/out/");
    expect(baseHrefFor("/index.html")).toBe("/");
    expect(baseHrefFor("/Users/me/Code/demo/.niceeval-site/index.html")).toBe(
      "/Users/me/Code/demo/.niceeval-site/",
    );
  });
});
