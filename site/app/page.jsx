import SiteAppClient from "../components/site-app-client";
import { getAllBlogPosts } from "../lib/blog";

export default function HomePage() {
  return <SiteAppClient initialRoute={{ name: "home" }} blogPosts={getAllBlogPosts()} />;
}

