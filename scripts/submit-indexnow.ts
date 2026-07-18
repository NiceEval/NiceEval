import { readFile } from "node:fs/promises";
import path from "node:path";

const HOST = "niceeval.com";
const KEY = "4b37f1e904e64086835ccaa2d5645d84";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP_PATH = path.join(process.cwd(), "site/public/sitemap-pages.xml");

function extractUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

async function main() {
  // 只在 Vercel 生产部署构建时提交，预览部署/本地构建跳过，避免刷 IndexNow 配额
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[indexnow] skip: VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"}`);
    return;
  }

  const xml = await readFile(SITEMAP_PATH, "utf8");
  const urlList = extractUrls(xml);
  if (urlList.length === 0) {
    console.warn(`[indexnow] skip: no <loc> entries found in ${SITEMAP_PATH}`);
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
