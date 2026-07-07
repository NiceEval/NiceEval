import { notFound } from "next/navigation";
import BlogIndexClient from "../../../components/site-blog-index-client";
import { getAllBlogPosts } from "../../../lib/blog";
import { getDictionary, hasLocale, locales } from "../../../lib/content";
import { JsonLd } from "../../../lib/json-ld";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return {
    title: "Blog",
    description: t.blogPage.meta,
    alternates: { canonical: `/${lang}/blog` },
    openGraph: {
      title: `${t.blogPage.title} | NiceEval`,
      description: t.blogPage.meta,
      type: "website",
      url: `/${lang}/blog`,
      siteName: "NiceEval",
      locale: lang === "zh" ? "zh_CN" : "en_US",
    },
  };
}

export default async function BlogIndexPage({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang);
  const blogPosts = getAllBlogPosts();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: t.blogPage.title,
          description: t.blogPage.meta,
          url: `https://niceeval.com/${lang}/blog`,
          blogPost: blogPosts.map((post) => ({
            "@type": "BlogPosting",
            headline: post[lang].title,
            description: post[lang].description,
            datePublished: post[lang].date,
            url: `https://niceeval.com/${lang}/blog/${post.slug}`,
          })),
        }}
      />
      <BlogIndexClient t={t} locale={lang} blogPosts={blogPosts} />
    </>
  );
}
