import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, XGame } from "../src/game.js";
import { FixtureProvider, type ContentProvider, type ImageRequest, type StructuredRequest } from "../src/provider.js";
import { worldSchema, type GeneratedImage } from "../src/contracts.js";

class ControlledFixtureProvider implements ContentProvider {
  readonly mode = "fixture" as const;
  readonly delegate = new FixtureProvider();
  failNextImage = false;

  generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    return this.delegate.generateStructured(request, signal);
  }

  generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    if (this.failNextImage) {
      this.failNextImage = false;
      return Promise.reject(new Error("fixture image failure"));
    }
    return this.delegate.generateImage(request, signal);
  }
}

const dataDirectory = mkdtempSync(join(tmpdir(), "llm-x-smoke-"));
process.env.LLM_X_DB_PATH = join(dataDirectory, "state.sqlite");

try {
  const { readWorld, writeWorld } = await import("../src/database.js");
  let game = await createWorld(
    { playerName: "验收玩家", topic: "夜间城市交通" },
    { provider: new FixtureProvider() },
  );
  writeWorld(game.snapshot());
  const persisted = readWorld();
  assert.ok(persisted);
  worldSchema.parse(persisted);
  assert.equal(Object.keys(persisted.profiles).length, 5);
  assert.equal(new Set(Object.values(persisted.profiles).map((profile) => profile.handle)).size, 5);

  game = XGame.restore(persisted, { provider: new FixtureProvider() });
  const beforePosts = game.snapshot().posts.length;
  const afterPost = await game.publishPost({ intent: "讨论末班车后的城市空间", withImage: true });
  const published = afterPost.posts.find((post) => post.authorId === afterPost.viewerId);
  assert.ok(published?.image);
  const afterReply = await game.reply({ postId: published.id, intent: "补充夜班工作者的视角" });
  assert.ok(afterReply.posts.some((post) => post.authorId === afterReply.viewerId && post.replyToId === published.id));
  const afterRefresh = await game.refreshFeed();
  assert.ok(afterRefresh.posts.length > beforePosts);
  writeWorld(afterRefresh);
  assert.equal(readWorld()?.revision, afterRefresh.revision);
  console.log(`smoke ok: profiles=${Object.keys(afterRefresh.profiles).length} posts=${afterRefresh.posts.length} revision=${afterRefresh.revision}`);

  const controlled = new ControlledFixtureProvider();
  const atomicGame = await createWorld(
    { playerName: "原子性玩家", topic: "生成失败时的状态安全" },
    { provider: controlled, now: () => new Date("2026-09-12T00:00:00.000Z") },
  );
  const beforeFailure = atomicGame.snapshot();
  controlled.failNextImage = true;
  await assert.rejects(atomicGame.publishPost({ intent: "这条内容要求配图", withImage: true }), /fixture image failure/);
  assert.deepEqual(atomicGame.snapshot(), beforeFailure, "图片失败不能污染已提交状态");
  console.log("persistence and atomicity ok");
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
