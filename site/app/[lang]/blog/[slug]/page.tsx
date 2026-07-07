import { notFound } from "next/navigation";
import BlogArticleClient from "../../../../components/site-blog-article-client";
import { getAllBlogPosts, getBlogPostBySlug } from "../../../../lib/blog";
import { getDictionary, hasLocale, locales } from "../../../../lib/content";
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
  return {
    title: postCopy.title,
    description: postCopy.description,
    alternates: { canonical: `/${lang}/blog/${slug}` },
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
          url: `https://niceeval.com/${lang}/blog/${slug}`,
          author: { "@type": "Organization", name: "NiceEval" },
          publisher: { "@type": "Organization", name: "NiceEval" },
        }}
      />
      <BlogArticleClient t={getDictionary(lang)} locale={lang} slug={slug} blogPosts={getAllBlogPosts()} />
    </>
  );
}
