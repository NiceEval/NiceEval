import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { worldSchema, type Post, type Profile, type World } from "./contracts";

const globalDatabase = globalThis as typeof globalThis & { llmXDatabase?: DatabaseSync };

function openDatabase(): DatabaseSync {
  const path = process.env.LLM_X_DB_PATH ?? join(process.cwd(), ".data", "llm-x.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      scenario TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      provider_mode TEXT NOT NULL CHECK (provider_mode IN ('live', 'fixture')),
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      handle TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT NOT NULL,
      location TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      avatar_alt TEXT NOT NULL,
      avatar_source TEXT NOT NULL,
      banner_url TEXT NOT NULL,
      banner_alt TEXT NOT NULL,
      banner_source TEXT NOT NULL,
      follower_count INTEGER NOT NULL CHECK (follower_count >= 0),
      following_count INTEGER NOT NULL CHECK (following_count >= 0),
      is_viewer INTEGER NOT NULL CHECK (is_viewer IN (0, 1)),
      UNIQUE (world_id, handle)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES profiles(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('post', 'reply', 'repost')),
      reply_to_id TEXT REFERENCES posts(id) DEFERRABLE INITIALLY DEFERRED,
      repost_of_id TEXT REFERENCES posts(id) DEFERRABLE INITIALLY DEFERRED,
      image_url TEXT,
      image_alt TEXT,
      image_source TEXT,
      like_count INTEGER NOT NULL CHECK (like_count >= 0),
      repost_count INTEGER NOT NULL CHECK (repost_count >= 0),
      reply_count INTEGER NOT NULL CHECK (reply_count >= 0)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS posts_world_created ON posts(world_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS posts_reply_to ON posts(reply_to_id);
  `);
  return database;
}

const database = globalDatabase.llmXDatabase ?? openDatabase();
globalDatabase.llmXDatabase = database;

export function readWorld(): World | null {
  const worldRow = database.prepare("SELECT * FROM worlds ORDER BY updated_at DESC LIMIT 1").get() as WorldRow | undefined;
  if (!worldRow) return null;
  const profileRows = database.prepare("SELECT * FROM profiles WHERE world_id = ?").all(worldRow.id) as unknown as ProfileRow[];
  const postRows = database.prepare("SELECT * FROM posts WHERE world_id = ? ORDER BY created_at DESC, id DESC").all(worldRow.id) as unknown as PostRow[];
  const profiles = Object.fromEntries(profileRows.map((row) => [row.id, profileFromRow(row)]));
  return worldSchema.parse({
    id: worldRow.id,
    scenario: worldRow.scenario,
    viewerId: worldRow.viewer_id,
    revision: worldRow.revision,
    providerMode: worldRow.provider_mode,
    profiles,
    posts: postRows.map(postFromRow),
  });
}

export function writeWorld(world: World): void {
  const value = worldSchema.parse(world);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM worlds");
    database.prepare("INSERT INTO worlds (id, scenario, viewer_id, revision, provider_mode, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(value.id, value.scenario, value.viewerId, value.revision, value.providerMode, new Date().toISOString());
    const insertProfile = database.prepare(`INSERT INTO profiles (
      id, world_id, handle, display_name, bio, location,
      avatar_url, avatar_alt, avatar_source, banner_url, banner_alt, banner_source,
      follower_count, following_count, is_viewer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const profile of Object.values(value.profiles)) {
      insertProfile.run(profile.id, value.id, profile.handle, profile.displayName, profile.bio, profile.location,
        profile.avatar.url, profile.avatar.alt, profile.avatar.source, profile.banner.url, profile.banner.alt, profile.banner.source,
        profile.followerCount, profile.followingCount, profile.isViewer ? 1 : 0);
    }
    const insertPost = database.prepare(`INSERT INTO posts (
      id, world_id, author_id, content, created_at, kind, reply_to_id, repost_of_id,
      image_url, image_alt, image_source, like_count, repost_count, reply_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const post of value.posts) {
      insertPost.run(post.id, value.id, post.authorId, post.content, post.createdAt, post.kind, post.replyToId, post.repostOfId,
        post.image?.url ?? null, post.image?.alt ?? null, post.image?.source ?? null,
        post.likeCount, post.repostCount, post.replyCount);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

interface WorldRow { id: string; scenario: string; viewer_id: string; revision: number; provider_mode: "live" | "fixture" }
interface ProfileRow { id: string; handle: string; display_name: string; bio: string; location: string; avatar_url: string; avatar_alt: string; avatar_source: "live" | "fixture"; banner_url: string; banner_alt: string; banner_source: "live" | "fixture"; follower_count: number; following_count: number; is_viewer: number }
interface PostRow { id: string; author_id: string; content: string; created_at: string; kind: Post["kind"]; reply_to_id: string | null; repost_of_id: string | null; image_url: string | null; image_alt: string | null; image_source: "live" | "fixture" | null; like_count: number; repost_count: number; reply_count: number }

function profileFromRow(row: ProfileRow): Profile {
  return { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, location: row.location,
    avatar: { url: row.avatar_url, alt: row.avatar_alt, source: row.avatar_source },
    banner: { url: row.banner_url, alt: row.banner_alt, source: row.banner_source },
    followerCount: row.follower_count, followingCount: row.following_count, isViewer: row.is_viewer === 1 };
}

function postFromRow(row: PostRow): Post {
  return { id: row.id, authorId: row.author_id, content: row.content, createdAt: row.created_at, kind: row.kind,
    replyToId: row.reply_to_id, repostOfId: row.repost_of_id,
    image: row.image_url && row.image_alt && row.image_source ? { url: row.image_url, alt: row.image_alt, source: row.image_source } : null,
    likeCount: row.like_count, repostCount: row.repost_count, replyCount: row.reply_count };
}
