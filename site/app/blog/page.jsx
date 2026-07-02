import SiteAppClient from "../../components/site-app-client";
import { getAllBlogPosts } from "../../lib/blog";

export const metadata = {
  title: "Blog",
  description: "Longer-form product and engineering notes about building agent evals with NiceEval.",
};

export default function BlogIndexPage() {
  return <SiteAppClient initialRoute={{ name: "blog" }} blogPosts={getAllBlogPosts()} />;
}

