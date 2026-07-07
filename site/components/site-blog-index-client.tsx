"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import type { BlogPost } from "../lib/blog";
import { withLocale, type Dictionary, type Locale } from "../lib/content";
import { Header } from "./site-header";
import { PostMeta } from "./site-blog-post-meta";

export default function BlogIndexClient({
  t,
  locale,
  blogPosts,
}: {
  t: Dictionary;
  locale: Locale;
  blogPosts: BlogPost[];
}) {
  useEffect(() => {
    initAnalytics();
    if (process.env.NODE_ENV === "development") {
      import("react-grab");
    }
  }, []);

  const post = blogPosts[0];

  return (
    <>
      <Header locale={locale} t={t} route={{ name: "blog" }} />
      <main>
        <section className="blog-page shell">
          <div className="blog-hero">
            <p className="eyebrow">{t.blogPage.eyebrow}</p>
            <h1>{t.blogPage.title}</h1>
            <p>{t.blogPage.intro}</p>
          </div>
          <div className="blog-section-head">
            <h2>{t.blogPage.latest}</h2>
          </div>
          {post ? (
            <article className="blog-card">
              <div className="blog-card-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="blog-card-copy">
                <span className="post-kicker">{post[locale].category}</span>
                <h2>{post[locale].title}</h2>
                <p>{post[locale].description}</p>
                <PostMeta postCopy={post[locale]} t={t} />
                <Link
                  className="button primary"
                  href={withLocale(locale, `blog/${post.slug}`)}
                  onClick={() => track("Open Blog Post", { slug: post.slug, locale })}
                >
                  {t.blogPage.read}
                  <ChevronRight size={15} />
                </Link>
              </div>
            </article>
          ) : (
            <p className="blog-empty">{t.blogPage.empty}</p>
          )}
        </section>
      </main>
    </>
  );
}
