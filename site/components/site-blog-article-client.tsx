"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import type { BlogPost } from "../lib/blog";
import { withLocale, type Dictionary, type Locale } from "../lib/content";
import { Header } from "./site-header";
import { PostMeta } from "./site-blog-post-meta";

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string };

function getBlogPost(blogPosts: BlogPost[], slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export default function BlogArticleClient({
  t,
  locale,
  slug,
  blogPosts,
}: {
  t: Dictionary;
  locale: Locale;
  slug: string;
  blogPosts: BlogPost[];
}) {
  useEffect(() => {
    initAnalytics();
    if (process.env.NODE_ENV === "development") {
      import("react-grab");
    }
  }, []);

  const post = getBlogPost(blogPosts, slug);

  return (
    <>
      <Header locale={locale} t={t} route={{ name: "post", slug }} />
      <main>
        {post ? (
          <ArticleBody t={t} locale={locale} post={post} />
        ) : (
          <section className="blog-page shell">
            <BlogBackLink t={t} locale={locale} />
            <div className="blog-hero">
              <h1>{t.blogPage.notFound}</h1>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function ArticleBody({ t, locale, post }: { t: Dictionary; locale: Locale; post: BlogPost }) {
  const postCopy = post[locale];

  return (
    <article className="article-page shell">
      <BlogBackLink t={t} locale={locale} />
      <header className="article-header">
        <div>
          <span className="post-kicker">{postCopy.category}</span>
          <h1>{postCopy.title}</h1>
          <p>{postCopy.description}</p>
          <PostMeta postCopy={postCopy} t={t} />
        </div>
        <div className="article-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </header>
      <MdxBody source={postCopy.body} />
    </article>
  );
}

function BlogBackLink({ t, locale }: { t: Dictionary; locale: Locale }) {
  return (
    <Link className="back-link" href={withLocale(locale, "blog")} onClick={() => track("Back To Blog")}>
      <ArrowLeft size={15} />
      {t.blogPage.back}
    </Link>
  );
}

function MdxBody({ source }: { source: string }) {
  const blocks = parseMarkdownBlocks(source);

  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag = `h${block.level}` as "h2" | "h3";
          return <HeadingTag key={index}>{formatInline(block.text)}</HeadingTag>;
        }
        if (block.type === "quote") {
          return <blockquote key={index}>{formatInline(block.text)}</blockquote>;
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{formatInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        return <p key={index}>{formatInline(block.text)}</p>;
      })}
    </div>
  );
}

function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.trim().split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 2 | 3, text: heading[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function formatInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}
