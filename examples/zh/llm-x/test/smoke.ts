import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createXServer } from "../src/server.js";
import { FixtureProvider, type ContentProvider, type ImageRequest, type StructuredRequest } from "../src/provider.js";
import { createWorld } from "../src/game.js";
import { worldSchema, type GeneratedImage, type World } from "../src/contracts.js";

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

const server = createXServer({ provider: new FixtureProvider() });
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /id="loading-title">正在加载/);
  assert.doesNotMatch(html, /world-form/);
  assert.doesNotMatch(html, /id="scenario"/);

  let world = await request<World>(base, "/api/world", {
    method: "POST",
    body: { playerName: "验收玩家", topic: "夜间城市交通" },
  });
  worldSchema.parse(world);
  assert.equal(world.providerMode, "fixture");
  assert.equal(Object.keys(world.profiles).length, 5);
  assert.ok(world.posts.length >= 4);
  assert.ok(Object.values(world.profiles).every((profile) => profile.avatar.source === "fixture"));

  const profile = await request<{ profile: { id: string }; posts: unknown[] }>(base, `/api/profiles/${world.viewerId}`);
  assert.equal(profile.profile.id, world.viewerId);

  const initialPostCount = world.posts.length;
  world = await request<World>(base, "/api/posts", {
    method: "POST",
    body: { intent: "我想讨论末班车后的城市空间", withImage: true },
  });
  const published = world.posts.find((post) => post.authorId === world.viewerId && post.kind === "post");
  assert.ok(published);
  assert.equal(published.image?.source, "fixture");
  assert.ok(world.posts.length > initialPostCount);

  world = await request<World>(base, `/api/posts/${published.id}/replies`, {
    method: "POST",
    body: { intent: "补充夜班工作者的视角" },
  });
  const reply = world.posts.find((post) => post.authorId === world.viewerId && post.replyToId === published.id);
  assert.ok(reply);

  const beforeRefresh = world.posts.length;
  world = await request<World>(base, "/api/feed/refresh", { method: "POST" });
  assert.ok(world.posts.length > beforeRefresh);

  const imageTarget = world.posts.find((post) => post.image === null);
  assert.ok(imageTarget);
  world = await request<World>(base, `/api/posts/${imageTarget.id}/image`, {
    method: "POST",
    body: { prompt: "blue hour city tram, documentary photography, no text" },
  });
  assert.equal(world.posts.find((post) => post.id === imageTarget.id)?.image?.source, "fixture");
  worldSchema.parse(world);
  console.log(`smoke ok: profiles=${Object.keys(world.profiles).length} posts=${world.posts.length} revision=${world.revision}`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const controlled = new ControlledFixtureProvider();
const atomicGame = await createWorld(
  { playerName: "原子性玩家", topic: "生成失败时的状态安全" },
  { provider: controlled, now: () => new Date("2026-09-12T00:00:00.000Z") },
);
const beforeFailure = atomicGame.snapshot();
controlled.failNextImage = true;
await assert.rejects(
  atomicGame.publishPost({ intent: "这条内容要求配图", withImage: true }),
  /fixture image failure/,
);
assert.deepEqual(atomicGame.snapshot(), beforeFailure, "provider 失败不能污染已提交状态");

const aborted = new AbortController();
aborted.abort();
await assert.rejects(atomicGame.refreshFeed(aborted.signal), { name: "AbortError" });
assert.deepEqual(atomicGame.snapshot(), beforeFailure, "取消不能污染已提交状态");
console.log("atomicity ok: failed generation and abort left state unchanged");

async function request<T>(base: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = {};
  if (options.method) init.method = options.method;
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, init);
  const value: unknown = await response.json();
  assert.ok(response.ok, `HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value as T;
}
