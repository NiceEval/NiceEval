"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { create } from "zustand";
import type { Post, Profile, World } from "../src/contracts";

type View = { type: "feed" } | { type: "profile"; profileId: string } | { type: "thread"; postId: string };

interface AppStore {
  world: World | null;
  view: View;
  busy: boolean;
  error: string | null;
  setWorld(world: World): void;
  setView(view: View): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
}

const useAppStore = create<AppStore>((set) => ({
  world: null,
  view: { type: "feed" },
  busy: false,
  error: null,
  setWorld: (world) => set({ world }),
  setView: (view) => set({ view }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
}));

let initialWorldRequest: Promise<World> | undefined;

function loadInitialWorld(): Promise<World> {
  initialWorldRequest ??= request<World | null>("/api/state").then((world) => world ?? request<World>("/api/world", {
    method: "POST",
    body: { playerName: "小周", topic: "今天正在发生的事" },
  }));
  return initialWorldRequest;
}

export default function Home() {
  const { world, view, busy, error, setWorld, setView, setBusy, setError } = useAppStore();

  useEffect(() => {
    loadInitialWorld().then(setWorld).catch((reason: unknown) => {
      initialWorldRequest = undefined;
      setError(message(reason));
    });
  }, [setError, setWorld]);

  async function mutate(operation: () => Promise<World>): Promise<World | undefined> {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      setWorld(next);
      return next;
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!world) return <Loading error={error} retry={() => {
    setError(null);
    loadInitialWorld().then(setWorld).catch((reason: unknown) => {
      initialWorldRequest = undefined;
      setError(message(reason));
    });
  }} />;

  const selectedProfile = view.type === "profile" ? world.profiles[view.profileId] : undefined;
  const selectedPost = view.type === "thread" ? world.posts.find((post) => post.id === view.postId) : undefined;

  return <main className="shell">
    <nav className="rail" aria-label="主导航">
      <div className="logo">𝕏</div>
      <button className={`nav ${view.type === "feed" ? "active" : ""}`} onClick={() => setView({ type: "feed" })}>⌂ <span>首页</span></button>
      <button className={`nav ${view.type === "profile" && view.profileId === world.viewerId ? "active" : ""}`} onClick={() => setView({ type: "profile", profileId: world.viewerId })}>◎ <span>个人主页</span></button>
    </nav>

    <section className="timeline">
      <header className="topbar">
        <strong>{view.type === "feed" ? "为你推荐" : view.type === "thread" ? "推文" : selectedProfile?.displayName ?? "个人主页"}</strong>
        {view.type === "feed" && <button className="ghost" disabled={busy} onClick={() => mutate(() => request("/api/feed/refresh", { method: "POST" }))}>刷新动态</button>}
        {view.type !== "feed" && <button className="ghost" onClick={() => setView({ type: "feed" })}>返回</button>}
      </header>
      {error && <div className="inline-error">{error}</div>}
      {view.type === "feed" && <Feed world={world} mutate={mutate} openPost={(postId) => setView({ type: "thread", postId })} openProfile={(profileId) => setView({ type: "profile", profileId })} />}
      {view.type === "thread" && selectedPost && <Thread world={world} root={selectedPost} mutate={mutate} openPost={(postId) => setView({ type: "thread", postId })} openProfile={(profileId) => setView({ type: "profile", profileId })} />}
      {view.type === "profile" && selectedProfile && <ProfileView world={world} profile={selectedProfile} openPost={(postId) => setView({ type: "thread", postId })} />}
    </section>

    <aside className="sidebar">
      <div className="panel"><h2>推荐关注</h2><div id="people">{Object.values(world.profiles).map((profile) => <button className="person" key={profile.id} onClick={() => setView({ type: "profile", profileId: profile.id })}><img src={profile.avatar.url} alt="" /><span><strong>{profile.displayName}</strong><span>@{profile.handle}</span></span></button>)}</div></div>
    </aside>
  </main>;
}

function Loading({ error, retry }: { error: string | null; retry(): void }) {
  return <main className="loading-page"><div className="loader" aria-hidden="true" /><h1>{error ? "加载失败" : "正在加载"}</h1><p>{error ?? "正在为你准备时间线……"}</p>{error && <button onClick={retry}>重试</button>}</main>;
}

function Feed({ world, mutate, openPost, openProfile }: ViewProps & { mutate(operation: () => Promise<World>): Promise<World | undefined> }) {
  const [intent, setIntent] = useState("");
  const [withImage, setWithImage] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!intent.trim()) return;
    const content = intent;
    setIntent("");
    setWithImage(false);
    await mutate(() => request("/api/posts", { method: "POST", body: { intent: content, withImage } }));
  }
  return <>
    <form className="composer" onSubmit={submit}>
      <img src={world.profiles[world.viewerId]!.avatar.url} alt="我的头像" />
      <div><textarea value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={500} placeholder="有什么新鲜事？" required /><footer><label className="check"><input type="checkbox" checked={withImage} onChange={(event) => setWithImage(event.target.checked)} /> 生成配图</label><button type="submit">发布</button></footer></div>
    </form>
    <div>{world.posts.map((post) => <PostCard key={post.id} world={world} post={post} openPost={openPost} openProfile={openProfile} />)}</div>
  </>;
}

interface ViewProps { world: World; openPost(postId: string): void; openProfile(profileId: string): void }

function Thread({ world, root, mutate, openPost, openProfile }: ViewProps & { root: Post; mutate(operation: () => Promise<World>): Promise<World | undefined> }) {
  const [intent, setIntent] = useState("");
  const [waiting, setWaiting] = useState(false);
  const setWorld = useAppStore((state) => state.setWorld);
  const posts = useMemo(() => threadPosts(world.posts, root.id), [root.id, world.posts]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!intent.trim()) return;
    const content = intent;
    setIntent("");
    const immediate = await mutate(() => request(`/api/posts/${encodeURIComponent(root.id)}/replies`, { method: "POST", body: { intent: content } }));
    if (immediate) {
      setWaiting(true);
      void pollForRevision(immediate.revision, setWorld).finally(() => setWaiting(false));
    }
  }
  return <div className="thread">
    <PostCard world={world} post={root} openPost={openPost} openProfile={openProfile} />
    <form className="reply-composer" onSubmit={submit}><textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="发布你的回复" maxLength={500} required /><button type="submit">回复</button></form>
    {waiting && <div className="reply-progress"><span className="mini-loader" />正在生成后续回复…</div>}
    <div className="thread-replies">{posts.slice(1).map((post) => <PostCard key={post.id} world={world} post={post} openPost={openPost} openProfile={openProfile} threadItem />)}</div>
  </div>;
}

function ProfileView({ world, profile, openPost }: { world: World; profile: Profile; openPost(postId: string): void }) {
  return <><section className="profile-card"><img className="banner" src={profile.banner.url} alt={profile.banner.alt} /><div className="profile-body"><img className="profile-avatar" src={profile.avatar.url} alt={profile.avatar.alt} /><h2>{profile.displayName}</h2><span>@{profile.handle}</span><p>{profile.bio}</p><p>⌖ {profile.location}</p><div className="stats"><span><b>{compact(profile.followingCount)}</b> 正在关注</span><span><b>{compact(profile.followerCount)}</b> 关注者</span></div></div></section>{world.posts.filter((post) => post.authorId === profile.id).map((post) => <PostCard key={post.id} world={world} post={post} openPost={openPost} openProfile={() => undefined} />)}</>;
}

function PostCard({ world, post, openPost, openProfile, threadItem = false }: ViewProps & { post: Post; threadItem?: boolean }) {
  const author = world.profiles[post.authorId]!;
  const targetId = post.replyToId ?? post.repostOfId;
  const target = targetId ? world.posts.find((candidate) => candidate.id === targetId) : undefined;
  const targetAuthor = target ? world.profiles[target.authorId] : undefined;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <article className={`post${threadItem ? " thread-item" : ""}`} onClick={() => openPost(post.id)}>
    <img className="avatar" src={author.avatar.url} alt={author.avatar.alt} onClick={(event) => { stop(event); openProfile(author.id); }} />
    <div>{post.kind !== "post" && <div className="context">{post.kind === "reply" ? "回复" : "转发"} @{targetAuthor?.handle ?? "unknown"}</div>}<div className="post-head"><button className="name" onClick={(event) => { stop(event); openProfile(author.id); }}>{author.displayName}</button><span className="handle">@{author.handle}</span><span className="time">· {relative(post.createdAt)}</span></div><p>{post.content}</p>{post.image && <img className="post-image" src={post.image.url} alt={post.image.alt} />}<div className="actions"><span>↩ {post.replyCount}</span><span>⟳ {post.repostCount}</span><span>♡ {post.likeCount}</span></div></div>
  </article>;
}

function threadPosts(posts: Post[], rootId: string): Post[] {
  const result: Post[] = [];
  const pending = [rootId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (seen.has(id)) continue;
    const post = posts.find((candidate) => candidate.id === id);
    if (!post) continue;
    seen.add(id);
    result.push(post);
    pending.push(...posts.filter((candidate) => candidate.replyToId === id || candidate.repostOfId === id).map((candidate) => candidate.id));
  }
  return result;
}

async function pollForRevision(revision: number, setWorld: (world: World) => void): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const world = await request<World | null>("/api/state");
    if (world && world.revision > revision) {
      setWorld(world);
      return;
    }
  }
}

async function request<T = World>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    ...(options.method ? { method: options.method } : {}),
    ...(options.body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function message(error: unknown) { return error instanceof Error ? error.message : "操作失败"; }
function compact(value: number) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function relative(timestamp: string) { const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)); return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时`; }
