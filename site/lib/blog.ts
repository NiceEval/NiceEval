import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const coverExtensions = ["png", "jpg", "jpeg", "webp"] as const;
const requiredFrontmatter = ["title", "description", "date", "category", "readMinutes"] as const;

export type BlogPostCopy = {
  title: string;
  description: string;
  date: string;
  category: string;
  readMinutes: string;
  status: string;
  body: string;
};

export type BlogPost = {
  slug: string;
  cover: string | null;
  en: BlogPostCopy;
  zh: BlogPostCopy;
};

function parseMdxDocument(source: string): BlogPostCopy {
  const frontmatterMatch = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter: Record<string, string> = {};
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

  for (const key of requiredFrontmatter) {
    if (!frontmatter[key]) {
      throw new Error(`Blog post is missing required frontmatter: ${key}`);
    }
  }

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    category: frontmatter.category,
    readMinutes: frontmatter.readMinutes,
    status: frontmatter.status ?? "published",
    body: body.trim(),
  };
}

function readPost(postsDir: string, slug: string, locale: "en" | "zh") {
  const postPath = `${postsDir}/${slug}/${locale}.mdx`;
  return parseMdxDocument(readFileSync(postPath, "utf8"));
}

// 封面图放在 public/blog/<slug>/cover.<ext>,和 mdx 内容分离,这样能直接以静态资源 URL 提供给
// <Image> 和 openGraph 元数据使用,不需要走 Next 的动态 import() 打包。
function findCover(coversDir: string, slug: string): string | null {
  for (const ext of coverExtensions) {
    if (existsSync(path.join(coversDir, slug, `cover.${ext}`))) {
      return `/blog/${slug}/cover.${ext}`;
    }
  }
  return null;
}

export function getAllBlogPosts(siteRoot = process.cwd()): BlogPost[] {
  const postsDir = path.join(siteRoot, "src/blog/posts");
  const coversDir = path.join(siteRoot, "public/blog");

  return readdirSync(postsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      cover: findCover(coversDir, entry.name),
      en: readPost(postsDir, entry.name, "en"),
      zh: readPost(postsDir, entry.name, "zh"),
    }))
    .filter((post) => post.en.status !== "draft" && post.zh.status !== "draft")
    .sort((a, b) => b.en.date.localeCompare(a.en.date));
}

export function getBlogPostBySlug(slug: string) {
  return getAllBlogPosts().find((post) => post.slug === slug) ?? null;
}
