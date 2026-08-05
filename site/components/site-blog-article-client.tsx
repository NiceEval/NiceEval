"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
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
  | { type: "code"; text: string; lang: string }
  | { type: "table"; header: string[]; rows: string[][] };

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

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
        {post.cover ? (
          <div className="article-mark">
            <Image src={post.cover} alt={postCopy.title} fill sizes="(max-width: 900px) 100vw, 40vw" priority />
          </div>
        ) : (
          <div className="article-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
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
        if (block.type === "table") {
          return (
            <div className="article-table" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex}>{formatInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{formatInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "code") {
          if (block.lang === "mermaid") {
            return <Mermaid key={index} chart={block.text} />;
          }
          return <CodeBlock key={index} code={block.text} lang={block.lang} />;
        }
        return <p key={index}>{formatInline(block.text)}</p>;
      })}
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const language = prismLanguage(lang);
  if (!language) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <Highlight code={code} language={language} theme={codeTheme}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={className} style={style}>
          {tokens.map((line, lineIndex) => (
            <div key={lineIndex} {...getLineProps({ line })}>
              {line.map((token, tokenIndex) => (
                <span key={tokenIndex} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

function prismLanguage(lang: string): string | undefined {
  if (lang === "ts") return "typescript";
  if (lang === "js") return "javascript";
  if (["typescript", "javascript", "tsx", "jsx", "bash", "json", "yaml", "css", "html"].includes(lang)) return lang;
  return undefined;
}

let mermaidIdCounter = 0;

function Mermaid({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [id] = useState(() => `mermaid-${mermaidIdCounter++}`);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(async ({ default: mermaid }) => {
      // 图跟站点同一套令牌(basalt):近黑面、发丝线、灰阶文字,节点不带自己的颜色。
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          background: "#0b0b0b",
          primaryColor: "#111111",
          primaryTextColor: "#ededed",
          primaryBorderColor: "#343434",
          secondaryColor: "#0b0b0b",
          tertiaryColor: "#050505",
          lineColor: "#74747b",
          textColor: "#a1a1aa",
        },
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
      });
      const { svg } = await mermaid.render(id, chart);
      if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
    });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return <div className="article-mermaid" ref={containerRef} />;
}

const TABLE_ROW = /^\|(.+)\|$/;
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.trim().split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] = [];
  let codeLang = "";
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n"), lang: codeLang });
        code = [];
        codeLang = "";
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = line.slice(3).trim();
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
    if (TABLE_ROW.test(line.trim()) && lines[i + 1] && TABLE_SEPARATOR.test(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length && TABLE_ROW.test(lines[cursor].trim())) {
        rows.push(splitTableRow(lines[cursor]));
        cursor++;
      }
      blocks.push({ type: "table", header, rows });
      i = cursor - 1;
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
  // code / bold / markdown link；顺序靠 split 捕获组，三者互不嵌套的常见写法都能处理
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      const external = /^https?:\/\//.test(href);
      return (
        <a key={index} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>
      );
    }
    return part;
  });
}
