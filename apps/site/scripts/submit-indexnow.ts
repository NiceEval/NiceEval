import path from "node:path";

import { getAllBlogPosts } from "../lib/blog";
import { absoluteUrl } from "../lib/content";
import { getSitemapUrls } from "../lib/sitemap";

const HOST = "niceeval.com";
const KEY = "4b37f1e904e64086835ccaa2d5645d84";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITE_ROOT = path.resolve(import.meta.dirname, "..");

async function main() {
  // Only a Vercel production deployment submits URLs. Preview and local builds
  // stay offline so a build cannot consume the IndexNow quota.
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

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });

  if (!response.ok) {
    console.warn(`[indexnow] submit failed: ${response.status} ${await response.text()}`);
    return;
  }

  console.log(`[indexnow] submitted ${urlList.length} URLs (status ${response.status})`);
}

main().catch((error: unknown) => {
  // Search notification is best-effort and must not invalidate a completed deploy build.
  console.warn("[indexnow] submit errored:", error);
});
