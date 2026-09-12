import { defineAdapter } from "niceeval";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  worldSchema,
  profileSchema,
  postSchema,
  type GenerateImageInput,
  type PublishPostInput,
  type ReplyInput,
} from "../src/index.js";
import { backendBuildId, startBackend } from "./backend.js";

export function defineX(options: {
  name: string;
  playerName: string;
  topic: string;
  behaviorRevision?: string;
}) {
  return defineAdapter({
    name: options.name,
    behaviorRevision: `${options.behaviorRevision ?? "1"}:${backendBuildId()}`,
    async create(context) {
      const controller = new AbortController();
      context.onCleanup(() => controller.abort());
      const signal = AbortSignal.any([context.signal, controller.signal]);
      const mode = context.flags.provider;
      if (mode !== "fixture" && mode !== "live") {
        throw new Error('Set flags.provider to "fixture" or "live".');
      }
      context.progress({ message: "Starting an isolated LLM X backend" });
      const backend = await startBackend({
        signal,
        onCleanup: (cleanup) => context.onCleanup(cleanup),
        env: {
          PROVIDER_MODE: mode,
          ...(mode === "live" ? {
            OPENAI_BASE_URL: stringFlag(context.flags.apiBase, "apiBase"),
            OPENAI_MODEL: stringFlag(context.model, "model"),
            OPENAI_IMAGE_MODEL: stringFlag(context.flags.imageModel, "imageModel"),
          } : {}),
        },
      });
      const readWorld = async () => worldSchema.parse(await backend.request("/state"));
      const writeWorld = async (path: string, body: unknown) => worldSchema.parse(await backend.request(path, body));
      await writeWorld("/world", { playerName: options.playerName, topic: options.topic });
      return {
        visitDiscoveryPage: readWorld,
        viewProfile: async (id: string) => z.object({ profile: profileSchema, posts: z.array(postSchema) }).strict()
          .parse(await backend.request(`/profiles/${encodeURIComponent(id)}`)),
        async post(input: PublishPostInput) {
          const before = await readWorld();
          const existing = new Set(before.posts.map((post) => post.id));
          const after = await writeWorld("/posts", input);
          const post = after.posts.find((post) =>
            post.authorId === before.viewerId && post.kind === "post" && !existing.has(post.id));
          if (!post) throw new Error("Publishing did not return a new player post.");
          return post;
        },
        async reply(input: ReplyInput) {
          const before = await readWorld();
          const existing = new Set(before.posts.map((post) => post.id));
          const after = await writeWorld(`/posts/${encodeURIComponent(input.postId)}/replies`, { intent: input.intent });
          const reply = after.posts.find((post) =>
            post.authorId === before.viewerId && post.replyToId === input.postId && !existing.has(post.id));
          if (!reply) throw new Error("Replying did not return a new player reply.");
          return reply;
        },
        async waitForReplies(postId: string) {
          const deadline = Date.now() + 60_000;
          while (true) {
            const world = await readWorld();
            const replies = world.posts.filter((post) => post.kind === "reply"
              && post.replyToId === postId && post.authorId !== world.viewerId);
            if (replies.length > 0) return replies;
            if (Date.now() >= deadline) throw new Error(`No AI replies appeared for ${postId} within 60 seconds.`);
            await delay(100, undefined, { signal });
          }
        },
        refreshFeed: () => writeWorld("/feed/refresh", {}),
        async generateImage(input: GenerateImageInput) {
          const after = await writeWorld(`/posts/${encodeURIComponent(input.postId)}/image`, { prompt: input.prompt });
          const image = after.posts.find((post) => post.id === input.postId)?.image;
          if (!image) throw new Error("Image generation did not attach an image to the selected post.");
          return image;
        },
      };
    },
  });
}

export const x = defineX({
  name: "llm-x",
  playerName: "小周",
  topic: "城市里的夜间生活",
  behaviorRevision: "2",
});

function stringFlag(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Configure ${name} for the live experiment.`);
  }
  return value;
}
