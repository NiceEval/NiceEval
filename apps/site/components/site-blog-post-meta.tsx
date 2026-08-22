import { CalendarDays, Clock3 } from "lucide-react";
import type { BlogPostCopy } from "../lib/blog";
import type { Dictionary } from "../lib/content";

export function PostMeta({ postCopy, t }: { postCopy: BlogPostCopy; t: Dictionary }) {
  return (
    <div className="post-meta">
      <span>
        <CalendarDays size={14} />
        {postCopy.date}
      </span>
      <span>
        <Clock3 size={14} />
        {postCopy.readMinutes} {t.blogPage.minutes}
      </span>
      <span>{postCopy.category}</span>
    </div>
  );
}
