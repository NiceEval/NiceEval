import { satisfies } from "niceeval/expect";
import type { GeneratedImage, Post, Profile, World } from "../src/index.js";

/** Keep image bytes out of assertion snapshots; these checks concern attachment, not aesthetics. */
export function imageMaterial(image: GeneratedImage | null) {
  return {
    present: image !== null,
    source: image?.source ?? null,
    alt: image?.alt ?? "",
    transport: image?.url.startsWith("data:image/") ? "image-data"
      : image?.url.startsWith("https://") ? "https" : "missing",
  };
}

export function postMaterial(post: Post) {
  return { ...post, image: imageMaterial(post.image) };
}

export function profileMaterial(profile: Profile) {
  return { ...profile, avatar: imageMaterial(profile.avatar), banner: imageMaterial(profile.banner) };
}

export function worldMaterial(world: World) {
  return {
    viewerId: world.viewerId,
    profiles: Object.values(world.profiles).map(profileMaterial),
    posts: world.posts.map(postMaterial),
    revision: world.revision,
    providerMode: world.providerMode,
  };
}

export const coherentSocialWorld = () => satisfies<ReturnType<typeof worldMaterial>>(
  "人物与推文关系完整",
  (world) => {
    const profiles = new Set(world.profiles.map((profile) => profile.id));
    const posts = new Set(world.posts.map((post) => post.id));
    if (!profiles.has(world.viewerId) || profiles.size !== world.profiles.length) return false;
    if (posts.size !== world.posts.length) return false;
    return world.posts.every((post) => {
      if (!profiles.has(post.authorId) || post.content.trim().length === 0) return false;
      if (post.kind === "post" && (post.replyToId !== null || post.repostOfId !== null)) return false;
      if (post.kind === "reply" && (!post.replyToId || !posts.has(post.replyToId) || post.repostOfId !== null)) return false;
      if (post.kind === "repost" && (!post.repostOfId || !posts.has(post.repostOfId) || post.replyToId !== null)) return false;
      return post.replyCount === world.posts.filter((reply) => reply.replyToId === post.id).length
        && post.repostCount === world.posts.filter((repost) => repost.repostOfId === post.id).length;
    });
  },
);

export const attachedImage = (mode: "fixture" | "live") => satisfies<ReturnType<typeof imageMaterial>>(
  "图片已生成并附着",
  (image) => image.present && image.source === mode && image.alt.length > 0 && image.transport !== "missing",
);

export const authoredPost = (authorId: string) => satisfies<Post>(
  "推文保留作者与正文",
  (post) => post.authorId === authorId && post.kind === "post"
    && post.replyToId === null && post.repostOfId === null && post.content.trim().length > 0,
);

export const authoredReply = (authorId: string, targetId: string) => satisfies<Post>(
  "回复保留作者与目标",
  (post) => post.authorId === authorId && post.kind === "reply"
    && post.replyToId === targetId && post.content.trim().length > 0,
);
