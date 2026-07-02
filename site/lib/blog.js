import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const postsDir = path.join(process.cwd(), "src/blog/posts");

function parseMdxDocument(source) {
  const frontmatterMatch = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = {};
  let body = source;

  if (frontmatterMatch) {
    body = source.slice(frontmatterMatch[0].length);
    for (const line of frontmatterMatch[1].split("\n")) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      frontmatter[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  return { ...frontmatter, body: body.trim() };
}

function readPost(slug, locale) {
  const path = `${postsDir}/${slug}/${locale}.mdx`;
  return parseMdxDocument(readFileSync(path, "utf8"));
}

export function getAllBlogPosts() {
  return readdirSync(postsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      en: readPost(entry.name, "en"),
      zh: readPost(entry.name, "zh"),
    }))
    .sort((a, b) => b.en.date.localeCompare(a.en.date));
}

export function getBlogPostBySlug(slug) {
  return getAllBlogPosts().find((post) => post.slug === slug) ?? null;
}
