import { createProviderFromEnv } from "./provider";
import { createWorld, XGame, type CreateWorldInput } from "./game";
import { readWorld, writeWorld } from "./database";
import type { World } from "./contracts";

const globalQueue = globalThis as typeof globalThis & { llmXMutationQueue?: Promise<void> };

function provider() {
  return createProviderFromEnv();
}

export function currentWorld(): World | null {
  return readWorld();
}

export async function replaceWorld(input: CreateWorldInput, signal?: AbortSignal): Promise<World> {
  return mutate(async () => {
    const game = await createWorld(input, { provider: provider() }, signal);
    const world = game.snapshot();
    writeWorld(world);
    return world;
  });
}

export async function updateWorld<T>(operation: (game: XGame) => Promise<T>): Promise<T> {
  return mutate(async () => {
    const world = readWorld();
    if (!world) throw new Error("请先加载时间线");
    const game = XGame.restore(world, { provider: provider() });
    const result = await operation(game);
    writeWorld(game.snapshot());
    return result;
  });
}

async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalQueue.llmXMutationQueue ?? Promise.resolve();
  let release!: () => void;
  globalQueue.llmXMutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}
