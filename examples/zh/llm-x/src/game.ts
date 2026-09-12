import {
  actionDraftSchema,
  feedDraftSchema,
  type ActionDraft,
  type FeedDraft,
  type GeneratedImage,
  type Post,
  type Profile,
  type World,
  worldDraftSchema,
} from "./contracts.js";
import type { ContentProvider } from "./provider.js";

export interface CreateWorldInput {
  playerName: string;
  topic: string;
}

export interface PublishPostInput {
  intent: string;
  withImage?: boolean;
}

export interface ReplyInput {
  postId: string;
  intent: string;
}

export interface GenerateImageInput {
  postId: string;
  prompt: string;
}

export interface GameDependencies {
  provider: ContentProvider;
  now?: () => Date;
}

export class ConcurrentWorldChangeError extends Error {
  constructor() {
    super("世界在生成期间发生了变化，请重试");
    this.name = "ConcurrentWorldChangeError";
  }
}

function requireText(value: string, label: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  if (normalized.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return normalized;
}

function cloneWorld(world: World): World {
  return structuredClone(world);
}

function assertNotAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export class XGame {
  private world: World;
  private nextPostNumber: number;

  private constructor(
    world: World,
    private readonly provider: ContentProvider,
    private readonly now: () => Date,
    nextPostNumber: number,
  ) {
    this.world = world;
    this.nextPostNumber = nextPostNumber;
  }

  static async create(input: CreateWorldInput, dependencies: GameDependencies, signal?: AbortSignal): Promise<XGame> {
    const playerName = requireText(input.playerName, "玩家名称", 40);
    const topic = requireText(input.topic, "世界主题", 160);
    assertNotAborted(signal);
    const draft = await dependencies.provider.generateStructured({
      name: "create_world",
      instructions: [
        "你是模拟社交平台 X 的世界生成器。",
        "创建玩家身份、3 到 6 位立场和语气不同的虚构人物，以及自然的首批中文推文。",
        "所有 handle 使用小写英文字母、数字或下划线且互不重复。人物与内容不得冒充真实个人。",
        "图片字段只写适合真实生图 API 的英文画面提示，不要输出 ID 或 URL。",
      ].join("\n"),
      input: { playerName, topic },
      schema: worldDraftSchema,
    }, signal);

    const allDraftProfiles = [draft.viewer, ...draft.characters];
    const handles = new Set(allDraftProfiles.map((profile) => profile.handle));
    if (handles.size !== allDraftProfiles.length) throw new Error("生成的人物 handle 不唯一");

    const profileAssets = await Promise.all(allDraftProfiles.map(async (profile) => ({
      avatar: await dependencies.provider.generateImage({
        prompt: profile.avatarPrompt,
        alt: `${profile.displayName} 的头像`,
        aspect: "square",
      }, signal),
      banner: await dependencies.provider.generateImage({
        prompt: profile.bannerPrompt,
        alt: `${profile.displayName} 的主页横幅`,
        aspect: "wide",
      }, signal),
    })));

    const profiles: Record<string, Profile> = {};
    const profileIdByHandle = new Map<string, string>();
    allDraftProfiles.forEach((profile, index) => {
      const id = `profile_${String(index + 1).padStart(4, "0")}`;
      profileIdByHandle.set(profile.handle, id);
      profiles[id] = {
        id,
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        location: profile.location,
        avatar: profileAssets[index]!.avatar,
        banner: profileAssets[index]!.banner,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        isViewer: index === 0,
      };
    });

    const initialImages = await Promise.all(draft.initialPosts.map((post) => post.imagePrompt
      ? dependencies.provider.generateImage({ prompt: post.imagePrompt, alt: "推文配图", aspect: "wide" }, signal)
      : Promise.resolve(null)));
    const createdAt = (dependencies.now ?? (() => new Date()))();
    const posts: Post[] = draft.initialPosts.map((post, index) => {
      const authorId = profileIdByHandle.get(post.authorHandle);
      if (!authorId) throw new Error(`首批推文引用了未知人物 @${post.authorHandle}`);
      return {
        id: `post_${String(index + 1).padStart(4, "0")}`,
        authorId,
        content: post.content,
        createdAt: new Date(createdAt.getTime() - index * 60_000).toISOString(),
        kind: "post",
        replyToId: null,
        repostOfId: null,
        image: initialImages[index] ?? null,
        likeCount: post.likeCount,
        repostCount: 0,
        replyCount: 0,
      };
    });
    const world: World = {
      id: "world_0001",
      scenario: draft.scenario,
      viewerId: "profile_0001",
      profiles,
      posts,
      revision: 0,
      providerMode: dependencies.provider.mode,
    };
    return new XGame(world, dependencies.provider, dependencies.now ?? (() => new Date()), posts.length + 1);
  }

  snapshot(): World {
    return cloneWorld(this.world);
  }

  viewProfile(profileId: string, signal?: AbortSignal): { profile: Profile; posts: Post[] } {
    assertNotAborted(signal);
    const profile = this.world.profiles[profileId];
    if (!profile) throw new Error("找不到这个人物");
    return {
      profile: structuredClone(profile),
      posts: this.world.posts.filter((post) => post.authorId === profileId).map((post) => structuredClone(post)),
    };
  }

  async publishPost(input: PublishPostInput, signal?: AbortSignal): Promise<World> {
    const intent = requireText(input.intent, "发帖意图", 500);
    return this.performAction("publish_post", { intent, withImage: input.withImage === true }, null, signal);
  }

  async reply(input: ReplyInput, signal?: AbortSignal): Promise<World> {
    const intent = requireText(input.intent, "回复意图", 500);
    this.requirePost(input.postId);
    return this.performAction("reply", { intent, withImage: false }, input.postId, signal);
  }

  async refreshFeed(signal?: AbortSignal): Promise<World> {
    const revision = this.world.revision;
    const actorIds = Object.keys(this.world.profiles).filter((id) => id !== this.world.viewerId);
    const draft = await this.provider.generateStructured<FeedDraft>({
      name: "refresh_feed",
      instructions: [
        "继续模拟 X 时间线，生成新的虚构人物动态。",
        "authorId 和 targetPostId 只能从输入列表选；回复或转发必须引用已有推文，普通推文 targetPostId 必须为 null。",
        "动态之间要有不同语气，可延续已有讨论，不得冒充现实人物。需要配图时给英文生图提示，否则为 null。",
      ].join("\n"),
      input: { world: this.promptSnapshot(), actorIds, postIds: this.world.posts.map((post) => post.id) },
      schema: feedDraftSchema,
    }, signal);
    const start = this.nextPostNumber;
    const posts = await Promise.all(draft.posts.map((post, index) => this.prepareGeneratedPost(post, this.postId(start + index), signal)));
    assertNotAborted(signal);
    this.commit(revision, posts);
    this.nextPostNumber += posts.length;
    return this.snapshot();
  }

  async generateImage(input: GenerateImageInput, signal?: AbortSignal): Promise<World> {
    const prompt = requireText(input.prompt, "图片提示", 500);
    const post = this.requirePost(input.postId);
    const revision = this.world.revision;
    const image = await this.provider.generateImage({ prompt, alt: `@${this.world.profiles[post.authorId]!.handle} 的推文配图`, aspect: "wide" }, signal);
    assertNotAborted(signal);
    if (this.world.revision !== revision) throw new ConcurrentWorldChangeError();
    const livePost = this.requirePost(input.postId);
    livePost.image = image;
    this.world.revision += 1;
    return this.snapshot();
  }

  private async performAction(
    name: "publish_post" | "reply",
    input: { intent: string; withImage: boolean },
    targetPostId: string | null,
    signal?: AbortSignal,
  ): Promise<World> {
    const revision = this.world.revision;
    const primaryId = this.postId(this.nextPostNumber);
    const actorIds = Object.keys(this.world.profiles).filter((id) => id !== this.world.viewerId);
    const draft = await this.provider.generateStructured<ActionDraft>({
      name,
      instructions: [
        "你是模拟 X 的内容与互动引擎。根据玩家意图写出最终中文推文，并生成 0 到 5 条自然的后续回复或转发。",
        "primaryContent 必须体现意图但不是原样复述。reaction authorId 只能从 actorIds 选。",
        "reaction 的 reply/repost 必须把 targetPostId 设为 primaryId 或已有 postIds；普通 post 必须为 null。",
        "需要配图时仅写英文生图提示；withImage 为 true 时 primaryImagePrompt 不得为 null。",
      ].join("\n"),
      input: {
        ...input,
        targetPostId,
        primaryId,
        actorIds,
        postIds: this.world.posts.map((post) => post.id),
        world: this.promptSnapshot(),
      },
      schema: actionDraftSchema,
    }, signal);
    if (input.withImage && !draft.primaryImagePrompt) throw new Error("模型没有为要求配图的推文提供生图提示");

    const primaryImage = draft.primaryImagePrompt
      ? await this.provider.generateImage({ prompt: draft.primaryImagePrompt, alt: "我的推文配图", aspect: "wide" }, signal)
      : null;
    const primary: Post = {
      id: primaryId,
      authorId: this.world.viewerId,
      content: draft.primaryContent,
      createdAt: this.now().toISOString(),
      kind: targetPostId ? "reply" : "post",
      replyToId: targetPostId,
      repostOfId: null,
      image: primaryImage,
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
    };
    const reactions = await Promise.all(draft.reactions.map((post, index) => this.prepareGeneratedPost(
      post,
      this.postId(this.nextPostNumber + index + 1),
      signal,
      primaryId,
    )));
    assertNotAborted(signal);
    this.commit(revision, [primary, ...reactions]);
    this.nextPostNumber += reactions.length + 1;
    return this.snapshot();
  }

  private async prepareGeneratedPost(
    draft: FeedDraft["posts"][number],
    id: string,
    signal?: AbortSignal,
    pendingPrimaryId?: string,
  ): Promise<Post> {
    if (!this.world.profiles[draft.authorId]) throw new Error(`生成动态引用了未知人物 ${draft.authorId}`);
    if (draft.authorId === this.world.viewerId) throw new Error("自动社交动态不能替玩家发言");
    const targetExists = draft.targetPostId === pendingPrimaryId || this.world.posts.some((post) => post.id === draft.targetPostId);
    if (draft.kind === "post" && draft.targetPostId !== null) throw new Error("普通推文不能引用目标推文");
    if (draft.kind !== "post" && (!draft.targetPostId || !targetExists)) throw new Error("回复或转发引用了未知推文");
    const image: GeneratedImage | null = draft.imagePrompt
      ? await this.provider.generateImage({ prompt: draft.imagePrompt, alt: "动态配图", aspect: "wide" }, signal)
      : null;
    return {
      id,
      authorId: draft.authorId,
      content: draft.content,
      createdAt: this.now().toISOString(),
      kind: draft.kind,
      replyToId: draft.kind === "reply" ? draft.targetPostId : null,
      repostOfId: draft.kind === "repost" ? draft.targetPostId : null,
      image,
      likeCount: draft.likeCount,
      repostCount: 0,
      replyCount: 0,
    };
  }

  private commit(expectedRevision: number, posts: Post[]): void {
    if (this.world.revision !== expectedRevision) throw new ConcurrentWorldChangeError();
    for (const post of posts) {
      const targetId = post.replyToId ?? post.repostOfId;
      if (targetId) {
        const target = posts.find((candidate) => candidate.id === targetId) ?? this.world.posts.find((candidate) => candidate.id === targetId);
        if (!target) throw new Error("提交前发现无效的推文引用");
        if (post.kind === "reply") target.replyCount += 1;
        if (post.kind === "repost") target.repostCount += 1;
      }
    }
    this.world.posts.unshift(...posts.reverse());
    this.world.revision += 1;
  }

  private requirePost(postId: string): Post {
    const post = this.world.posts.find((candidate) => candidate.id === postId);
    if (!post) throw new Error("找不到这条推文");
    return post;
  }

  private postId(number: number): string {
    return `post_${String(number).padStart(4, "0")}`;
  }

  private promptSnapshot(): unknown {
    return {
      scenario: this.world.scenario,
      profiles: Object.values(this.world.profiles).map(({ id, handle, displayName, bio }) => ({ id, handle, displayName, bio })),
      recentPosts: this.world.posts.slice(0, 12).map(({ id, authorId, content, kind, replyToId, repostOfId }) => ({ id, authorId, content, kind, replyToId, repostOfId })),
    };
  }
}

export async function createWorld(input: CreateWorldInput, dependencies: GameDependencies, signal?: AbortSignal): Promise<XGame> {
  return XGame.create(input, dependencies, signal);
}

export function viewProfile(game: XGame, profileId: string, signal?: AbortSignal) {
  return game.viewProfile(profileId, signal);
}

export function publishPost(game: XGame, input: PublishPostInput, signal?: AbortSignal) {
  return game.publishPost(input, signal);
}

export function reply(game: XGame, input: ReplyInput, signal?: AbortSignal) {
  return game.reply(input, signal);
}

export function refreshFeed(game: XGame, signal?: AbortSignal) {
  return game.refreshFeed(signal);
}

export function generateImage(game: XGame, input: GenerateImageInput, signal?: AbortSignal) {
  return game.generateImage(input, signal);
}
