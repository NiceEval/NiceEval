import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../site/proxy";
import { absoluteUrl, copy, withLocale } from "../../site/lib/content";

// 仓库守护:产品站英文正式 URL 是无前缀路径,旧 /en/* 永久去前缀,根路径不按请求语言漂移。
// 删除这组守护后,站内链接/SEO 产物或 Proxy 任一处回到旧口径,构建仍可能成功而搜索引擎与用户
// 会分别看到重复地址或错误语言——这类回归没有其它核心测试会报警。
const ROOT = resolve(import.meta.dirname, "../..");

describe("产品站英文 URL 迁移", () => {
  it("helper 为英文生成根路径,中文保留 /zh,绝对 URL 与首页 title 契约一致", () => {
    expect(withLocale("en")).toBe("/");
    expect(withLocale("en", "blog/post")).toBe("/blog/post");
    expect(withLocale("zh")).toBe("/zh");
    expect(withLocale("zh", "blog/post")).toBe("/zh/blog/post");
    expect(absoluteUrl("/")).toBe("https://niceeval.com");
    expect(absoluteUrl("/blog")).toBe("https://niceeval.com/blog");
    expect(copy.en.titleHome.length).toBeLessThanOrEqual(60);
  });

  it("旧英文 URL 返回 308 并保留查询参数,无前缀根路径只 rewrite 到内部英文路由", () => {
    const legacyResponse = proxy(
      new NextRequest("https://niceeval.com/en/blog/post?utm_source=legacy"),
    );
    expect(legacyResponse?.status).toBe(308);
    expect(legacyResponse?.headers.get("location")).toBe(
      "https://niceeval.com/blog/post?utm_source=legacy",
    );

    const rootResponse = proxy(
      new NextRequest("https://niceeval.com/", {
        headers: { "accept-language": "zh-CN,zh;q=0.9" },
      }),
    );
    expect(rootResponse?.status).toBe(200);
    expect(rootResponse?.headers.get("location")).toBeNull();
    expect(rootResponse?.headers.get("x-middleware-rewrite")).toBe("https://niceeval.com/en");
  });

  it("sitemap 与 llms.txt 只发布正式英文地址并声明 x-default", () => {
    const sitemap = readFileSync(join(ROOT, "site/public/sitemap-pages.xml"), "utf8");
    const llms = readFileSync(join(ROOT, "site/public/llms.txt"), "utf8");

    expect(sitemap).not.toContain("https://niceeval.com/en");
    expect(sitemap).toContain('hreflang="x-default" href="https://niceeval.com/"');
    expect(sitemap).toContain(
      'hreflang="x-default" href="https://niceeval.com/blog/prompt-evaluation-vs-agent-evaluation"',
    );
    expect(llms).not.toContain("https://niceeval.com/en");
    expect(llms).toContain("https://niceeval.com/blog");
  });
});
