import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAllBlogPosts } from "../../apps/site/lib/blog";
import { proxy } from "../../apps/site/proxy";
import { absoluteUrl, copy, withLocale } from "../../apps/site/lib/content";
import { createPagesSitemap } from "../../apps/site/lib/sitemap";

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

  it("旧英文 URL 与 www 返回 308 并保留路径和查询参数,正式根路径不由 proxy 接管", () => {
    const legacyResponse = proxy(
      new NextRequest("https://niceeval.com/en/blog/post?utm_source=legacy"),
    );
    expect(legacyResponse?.status).toBe(308);
    expect(legacyResponse?.headers.get("location")).toBe(
      "https://niceeval.com/blog/post?utm_source=legacy",
    );

    const duplicateHostResponse = proxy(
      new NextRequest("https://www.niceeval.com/en/blog/post?utm_source=www"),
    );
    expect(duplicateHostResponse?.status).toBe(308);
    expect(duplicateHostResponse?.headers.get("location")).toBe(
      "https://niceeval.com/blog/post?utm_source=www",
    );

    const forwardedHostResponse = proxy(
      new NextRequest("http://127.0.0.1:3000/robots.txt", {
        headers: { "x-forwarded-host": "www.niceeval.com" },
      }),
    );
    expect(forwardedHostResponse?.status).toBe(308);
    expect(forwardedHostResponse?.headers.get("location")).toBe("https://niceeval.com/robots.txt");

    // 根路径映射在 next.config rewrites(route-level rewrite 不会再次进入 proxy,
    // 避免 / → /en → / 无限重定向),proxy 对根路径直接放行。
    const rootResponse = proxy(
      new NextRequest("https://niceeval.com/", {
        headers: { "accept-language": "zh-CN,zh;q=0.9" },
      }),
    );
    expect(rootResponse).toBeUndefined();
  });

  it("next.config 把无前缀根路径 rewrite 到 /en 渲染源,并排除 zh 与静态/外部接管路径", () => {
    const nextConfig = readFileSync(join(ROOT, "apps/site/next.config.mjs"), "utf8");
    expect(nextConfig).toContain('source: "/:path((?!_next|docs|showcase|zh|.*\\\\..*).*)"');
    expect(nextConfig).toContain('destination: "/en/:path"');
  });

  it("sitemap 与 llms.txt 只发布正式英文地址并声明 x-default", () => {
    const sitemap = createPagesSitemap(getAllBlogPosts(join(ROOT, "apps/site")));
    const llms = readFileSync(join(ROOT, "apps/site/public/llms.txt"), "utf8");

    expect(sitemap).not.toContain("https://niceeval.com/en");
    expect(sitemap).toContain('hreflang="x-default" href="https://niceeval.com/"');
    expect(sitemap).toContain(
      'hreflang="x-default" href="https://niceeval.com/blog/prompt-evaluation-vs-agent-evaluation"',
    );
    expect(sitemap).toContain("https://niceeval.com/blog/introducing-memorybench");
    expect(sitemap).toContain("<lastmod>2026-08-05</lastmod>");
    expect(llms).not.toContain("https://niceeval.com/en");
    expect(llms).toContain("https://niceeval.com/blog");
  });
});
