import { currentWorld, replaceWorld, updateWorld } from "../../../src/application";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    if (path.length === 1 && path[0] === "state") return Response.json(currentWorld());
    if (path.length === 2 && path[0] === "profiles") {
      const world = currentWorld();
      if (!world) throw new Error("请先加载时间线");
      const profile = world.profiles[path[1]!];
      if (!profile) return Response.json({ error: "找不到这个用户" }, { status: 404 });
      return Response.json({ profile, posts: world.posts.filter((post) => post.authorId === profile.id) });
    }
    return Response.json({ error: "路由不存在" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path;
    const body = await readBody(request);
    if (path.length === 1 && path[0] === "world") {
      return Response.json(await replaceWorld({
        playerName: stringField(body, "playerName"),
        topic: stringField(body, "topic"),
      }, request.signal), { status: 201 });
    }
    if (path.length === 1 && path[0] === "posts") {
      return Response.json(await updateWorld((game) => game.publishPost({
        intent: stringField(body, "intent"),
        withImage: body.withImage === true,
      }, request.signal)), { status: 201 });
    }
    if (path.length === 3 && path[0] === "posts" && path[2] === "replies") {
      const world = await updateWorld((game) => game.reply({
        postId: path[1]!,
        intent: stringField(body, "intent"),
      }, request.signal));
      const reply = world.posts.find((post) => post.authorId === world.viewerId && post.replyToId === path[1]);
      if (reply) {
        after(async () => {
          try {
            await updateWorld((game) => game.continueThread(reply.id));
          } catch (error) {
            console.error("Failed to continue reply thread", error);
          }
        });
      }
      return Response.json(world, { status: 201 });
    }
    if (path.length === 3 && path[0] === "posts" && path[2] === "image") {
      return Response.json(await updateWorld((game) => game.generateImage({
        postId: path[1]!,
        prompt: stringField(body, "prompt"),
      }, request.signal)), { status: 201 });
    }
    if (path.length === 2 && path[0] === "feed" && path[1] === "refresh") {
      return Response.json(await updateWorld((game) => game.refreshFeed(request.signal)));
    }
    return Response.json({ error: "路由不存在" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json().catch(() => ({}));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求内容必须是对象");
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

function failure(error: unknown) {
  const aborted = error instanceof Error && error.name === "AbortError";
  return Response.json({ error: error instanceof Error ? error.message : "未知错误" }, { status: aborted ? 499 : 400 });
}
