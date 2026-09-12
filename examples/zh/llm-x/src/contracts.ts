import { z } from "zod";

export const imageSchema = z.object({
  url: z.string().min(1),
  alt: z.string().min(1).max(180),
  source: z.enum(["live", "fixture"]),
}).strict();

export const profileSchema = z.object({
  id: z.string().min(1),
  handle: z.string().regex(/^[a-z0-9_]{2,20}$/),
  displayName: z.string().min(1).max(40),
  bio: z.string().min(1).max(180),
  location: z.string().min(1).max(50),
  avatar: imageSchema,
  banner: imageSchema,
  followerCount: z.number().int().nonnegative(),
  followingCount: z.number().int().nonnegative(),
  isViewer: z.boolean(),
}).strict();

export const postSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  content: z.string().min(1).max(280),
  createdAt: z.string().datetime(),
  kind: z.enum(["post", "reply", "repost"]),
  replyToId: z.string().min(1).nullable(),
  repostOfId: z.string().min(1).nullable(),
  image: imageSchema.nullable(),
  likeCount: z.number().int().nonnegative(),
  repostCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
}).strict();

export const worldSchema = z.object({
  id: z.string().min(1),
  scenario: z.string().min(1),
  viewerId: z.string().min(1),
  profiles: z.record(z.string(), profileSchema),
  posts: z.array(postSchema),
  revision: z.number().int().nonnegative(),
  providerMode: z.enum(["live", "fixture"]),
}).strict();

export type GeneratedImage = z.infer<typeof imageSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Post = z.infer<typeof postSchema>;
export type World = z.infer<typeof worldSchema>;

const generatedProfileSchema = z.object({
  displayName: z.string().min(1).max(40),
  bio: z.string().min(1).max(180),
  location: z.string().min(1).max(50),
  avatarPrompt: z.string().min(8).max(500),
}).strict();

export const worldDraftSchema = z.object({
  viewer: generatedProfileSchema,
  characters: z.array(generatedProfileSchema).min(3).max(6),
  initialPosts: z.array(z.object({
    content: z.string().min(1).max(280),
    imagePrompt: z.string().min(8).max(500).nullable(),
  }).strict()).min(4).max(12),
}).strict();

export const generatedPostSchema = z.object({
  content: z.string().min(1).max(280),
  imagePrompt: z.string().min(8).max(500).nullable(),
}).strict();

export const actionDraftSchema = z.object({
  primaryContent: z.string().min(1).max(280),
  primaryImagePrompt: z.string().min(8).max(500).nullable(),
  reactions: z.array(generatedPostSchema).max(5),
}).strict();

export const feedDraftSchema = z.object({
  posts: z.array(generatedPostSchema).min(1).max(8),
}).strict();

export type WorldDraft = z.infer<typeof worldDraftSchema>;
export type ActionDraft = z.infer<typeof actionDraftSchema>;
export type FeedDraft = z.infer<typeof feedDraftSchema>;
