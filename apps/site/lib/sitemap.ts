import type { BlogPost } from "./blog";
import { absoluteUrl, withLocale, type Locale } from "./content";

type SitemapEntry = {
  path: string;
  alternates: Record<Locale | "x-default", string>;
  lastModified?: string;
  changeFrequency: "weekly" | "monthly";
  priority: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sitemapUrl(path: string) {
  const url = absoluteUrl(path);
  return path === "/" ? `${url}/` : url;
}

function localizedEntries(
  path: string,
  options: Pick<SitemapEntry, "lastModified" | "changeFrequency" | "priority">,
): SitemapEntry[] {
  const localizedPaths = {
    en: withLocale("en", path),
    zh: withLocale("zh", path),
  };
  const alternates = {
    ...localizedPaths,
    "x-default": localizedPaths.en,
  };

  return (["en", "zh"] as const).map((locale) => ({
    path: localizedPaths[locale],
    alternates,
    ...options,
  }));
}

export function getSitemapUrls(posts: BlogPost[]) {
  const latestPostDate = posts[0]?.en.date;
  const entries = [
    ...localizedEntries("", { changeFrequency: "weekly", priority: "1.0" }),
    ...localizedEntries("blog", {
      lastModified: latestPostDate,
      changeFrequency: "weekly",
      priority: "0.8",
    }),
    ...posts.flatMap((post) =>
      localizedEntries(`blog/${post.slug}`, {
        lastModified: post.en.date,
        changeFrequency: "monthly",
        priority: "0.7",
      }),
    ),
  ];

  return entries;
}

export function createPagesSitemap(posts: BlogPost[]) {
  const urls = getSitemapUrls(posts)
    .map(
      ({ path, alternates, lastModified, changeFrequency, priority }) => `  <url>
    <loc>${escapeXml(sitemapUrl(path))}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(sitemapUrl(alternates.en))}" />
    <xhtml:link rel="alternate" hreflang="zh" href="${escapeXml(sitemapUrl(alternates.zh))}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(sitemapUrl(alternates["x-default"]))}" />${
      lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ""
    }
    <changefreq>${changeFrequency}</changefreq>
    <priority>${priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}
