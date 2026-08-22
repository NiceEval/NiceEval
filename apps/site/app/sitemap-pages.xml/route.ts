import { getAllBlogPosts } from "../../lib/blog";
import { createPagesSitemap } from "../../lib/sitemap";

export const dynamic = "force-static";

export function GET() {
  return new Response(createPagesSitemap(getAllBlogPosts()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
