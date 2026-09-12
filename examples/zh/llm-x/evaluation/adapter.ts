import { defineAdapter } from "niceeval";
import {
  FixtureProvider,
  OpenAICompatibleProvider,
  XGame,
  type GenerateImageInput,
  type PublishPostInput,
  type ReplyInput,
} from "../src/index.js";

export function defineX(options: {
  name: string;
  playerName: string;
  topic: string;
  behaviorRevision?: string;
}) {
  return defineAdapter({
    name: options.name,
    ...(options.behaviorRevision === undefined ? {} : { behaviorRevision: options.behaviorRevision }),
    async create(context) {
      const controller = new AbortController();
      context.onCleanup(() => controller.abort());
      const signal = AbortSignal.any([context.signal, controller.signal]);
      const mode = context.flags.provider;
      if (mode !== "fixture" && mode !== "live") {
        throw new Error('Set flags.provider to "fixture" or "live".');
      }
      const provider = mode === "fixture"
        ? new FixtureProvider()
        : new OpenAICompatibleProvider({
            apiKey: process.env.X_API_KEY ?? "",
            apiBase: stringFlag(context.flags.apiBase, "apiBase"),
            textModel: stringFlag(context.model, "model"),
            imageModel: stringFlag(context.flags.imageModel, "imageModel"),
          });
      context.progress({ message: "Generating the simulated social world" });
      const game = await XGame.create(
        { playerName: options.playerName, topic: options.topic },
        { provider },
        signal,
      );
      // These are ordinary application methods. NiceEval infers the Eval's t
      // from this object; the game itself knows nothing about the evaluator.
      return {
        visitDiscoveryPage: () => game.snapshot(),
        viewProfile: (id: string) => game.viewProfile(id, signal),
        async post(input: PublishPostInput) {
          const before = game.snapshot();
          const existing = new Set(before.posts.map((post) => post.id));
          const after = await game.publishPost(input, signal);
          const post = after.posts.find((post) =>
            post.authorId === before.viewerId && post.kind === "post" && !existing.has(post.id));
          if (!post) throw new Error("Publishing did not return a new player post.");
          return post;
        },
        async reply(input: ReplyInput) {
          const before = game.snapshot();
          const existing = new Set(before.posts.map((post) => post.id));
          const after = await game.reply(input, signal);
          const reply = after.posts.find((post) =>
            post.authorId === before.viewerId && post.replyToId === input.postId && !existing.has(post.id));
          if (!reply) throw new Error("Replying did not return a new player reply.");
          return reply;
        },
        refreshFeed: () => game.refreshFeed(signal),
        async generateImage(input: GenerateImageInput) {
          const after = await game.generateImage(input, signal);
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
  behaviorRevision: "1",
});

function stringFlag(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Configure ${name} for the live experiment.`);
  }
  return value;
}
