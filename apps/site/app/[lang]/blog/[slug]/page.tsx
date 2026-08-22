import { notFound } from "next/navigation";
import BlogArticleClient from "../../../../components/site-blog-article-client";
import { getAllBlogPosts, getBlogPostBySlug } from "../../../../lib/blog";
import { absoluteUrl, getDictionary, hasLocale, locales, withLocale } from "../../../../lib/content";
import { JsonLd } from "../../../../lib/json-ld";

type BlogPostParams = Promise<{ lang: string; slug: string }>;

export function generateStaticParams() {
  return locales.flatMap((lang) => getAllBlogPosts().map((post) => ({ lang, slug: post.slug })));
}

export async function generateMetadata({ params }: { params: BlogPostParams }) {
  const { lang, slug } = await params;
  if (!hasLocale(lang)) return {};

  const post = getBlogPostBySlug(slug);
  if (!post) {
    return { title: "Post not found" };
  }

  const postCopy = post[lang];
  const path = withLocale(lang, `blog/${slug}`);
  return {
    title: postCopy.title,
    description: postCopy.description,
    alternates: {
      canonical: path,
      languages: {
        en: withLocale("en", `blog/${slug}`),
        zh: withLocale("zh", `blog/${slug}`),
        "x-default": withLocale("en", `blog/${slug}`),
      },
    },
    openGraph: {
      title: `${postCopy.title} | NiceEval`,
      description: postCopy.description,
      type: "article",
      url: path,
      siteName: "NiceEval",
      locale: lang === "zh" ? "zh_CN" : "en_US",
      publishedTime: postCopy.date,
      images: post.cover ? [post.cover] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: BlogPostParams }) {
  const { lang, slug } = await params;
  if (!hasLocale(lang)) notFound();

  const post = getBlogPostBySlug(slug);
  if (!post) notFound();
  const postCopy = post[lang];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: postCopy.title,
          description: postCopy.description,
          datePublished: postCopy.date,
          articleSection: postCopy.category,
          image: post.cover ? absoluteUrl(post.cover) : undefined,
          url: absoluteUrl(withLocale(lang, `blog/${slug}`)),
          author: { "@type": "Organization", name: "NiceEval" },
          publisher: { "@type": "Organization", name: "NiceEval" },
        }}
      />
      <BlogArticleClient t={getDictionary(lang)} locale={lang} slug={slug} blogPosts={getAllBlogPosts()} />
    </>
  );
}
