import path from "node:path";
import { getAllBlogPosts } from "../apps/site/lib/blog";
import { absoluteUrl } from "../apps/site/lib/content";
import { getSitemapUrls } from "../apps/site/lib/sitemap";

const HOST = "niceeval.com";
const KEY = "4b37f1e904e64086835ccaa2d5645d84";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITE_ROOT = path.join(process.cwd(), "apps", "site");

async function main() {
  // 只在 Vercel 生产部署构建时提交，预览部署/本地构建跳过，避免刷 IndexNow 配额
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[indexnow] skip: VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"}`);
    return;
  }

  const urlList = getSitemapUrls(getAllBlogPosts(SITE_ROOT)).map(({ path: urlPath }) =>
    absoluteUrl(urlPath),
  );
  if (urlList.length === 0) {
    console.warn("[indexnow] skip: generated sitemap has no URLs");
    return;
  }

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });

  if (!res.ok) {
    console.warn(`[indexnow] submit failed: ${res.status} ${await res.text()}`);
    return;
  }

  console.log(`[indexnow] submitted ${urlList.length} URLs (status ${res.status})`);
}

main().catch((err) => {
  // 提交失败不应该拖垮部署构建
  console.warn("[indexnow] submit errored:", err);
});
