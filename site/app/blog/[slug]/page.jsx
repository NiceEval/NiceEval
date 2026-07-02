import { notFound } from "next/navigation";
import SiteAppClient from "../../../components/site-app-client";
import { getAllBlogPosts, getBlogPostBySlug } from "../../../lib/blog";

export function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) {
    return {
      title: "Post not found",
    };
  }

  return {
    title: post.en.title,
    description: post.en.description,
  };
}

export default async function BlogPostPage({ params }) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) notFound();

  return <SiteAppClient initialRoute={{ name: "post", slug }} blogPosts={getAllBlogPosts()} />;
}
