import { notFound } from "next/navigation";
import BlogIndexClient from "../../../components/site-blog-index-client";
import { getAllBlogPosts } from "../../../lib/blog";
import { absoluteUrl, getDictionary, hasLocale, locales, withLocale } from "../../../lib/content";
import { JsonLd } from "../../../lib/json-ld";

type LangParams = Promise<{ lang: string }>;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: LangParams }) {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  const featuredCover = getAllBlogPosts()[0]?.cover;
  const path = withLocale(lang, "blog");
  return {
    title: t.titleBlog,
    description: t.blogPage.meta,
    alternates: {
      canonical: path,
      languages: {
        en: withLocale("en", "blog"),
        zh: withLocale("zh", "blog"),
        "x-default": withLocale("en", "blog"),
      },
    },
    openGraph: {
      title: `${t.titleBlog} | NiceEval`,
      description: t.blogPage.meta,
      type: "website",
      url: path,
      siteName: "NiceEval",
      locale: lang === "zh" ? "zh_CN" : "en_US",
      images: featuredCover ? [featuredCover] : undefined,
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
          url: absoluteUrl(withLocale(lang, "blog")),
          blogPost: blogPosts.map((post) => ({
            "@type": "BlogPosting",
            headline: post[lang].title,
            description: post[lang].description,
            datePublished: post[lang].date,
            image: post.cover ? absoluteUrl(post.cover) : undefined,
            url: absoluteUrl(withLocale(lang, `blog/${post.slug}`)),
          })),
        }}
      />
      <BlogIndexClient t={t} locale={lang} blogPosts={blogPosts} />
    </>
  );
}
