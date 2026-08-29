import {
  createE2EContext,
  waitForOutput,
  type ArtifactStageEntry,
  type ProcessHandle,
} from "@niceeval/testkit";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

/**
 * 每个 owner 在自己的副本内通过安装后 CLI 生成 Record；这里仅声明副本
 * 生命周期和 candidate 的 node_modules 链接，不隐藏产品 argv 或 expected。
 */
export const insightProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-insight-",
  omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/**
 * Insight Repo 的机械 E2E context。每个 owner 保留完整公开 argv 与 expected。
 */
export const insightE2E = createE2EContext({
  repoId: "insight",
  project: insightProjectCopy,
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/**
 * 失败时只收集本 case 由公开 `exp` 产生的 opaque Record。
 */
export function insightCaseArtifacts(): readonly ArtifactStageEntry[] {
  return [
    { source: ".niceeval", target: ".niceeval", optional: true },
  ];
}

export interface ViewLifecycleEvent {
  readonly protocol: "niceeval.view-lifecycle/v1";
  readonly event: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

/** Decode only the public NDJSON lifecycle stream; diagnostics belong on stderr. */
export function decodeViewLifecycle(stdout: string): readonly ViewLifecycleEvent[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const value = JSON.parse(line) as Partial<ViewLifecycleEvent>;
      if (value.protocol !== "niceeval.view-lifecycle/v1" || typeof value.event !== "string") {
        throw new Error(`view stdout contained a non-lifecycle line: ${line}`);
      }
      return value as ViewLifecycleEvent;
    });
}

export async function waitForViewReady(view: ProcessHandle): Promise<ViewLifecycleEvent & { readonly url: string }> {
  const output = await waitForOutput(view, "stdout", /"event":"ready"/, {
    timeoutMs: 30_000,
    label: "niceeval view lifecycle ready event",
  });
  const ready = decodeViewLifecycle(output).find((event) => event.event === "ready");
  if (ready === undefined || typeof ready.url !== "string") {
    throw new Error(`view ready event did not carry a URL: ${output}`);
  }
  return ready as ViewLifecycleEvent & { readonly url: string };
}

export function expectLoopbackReadyUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) {
    throw new Error(`view ready URL is not loopback HTTP: ${value}`);
  }
  if (url.hash.length <= 1) {
    throw new Error(`view ready URL is missing its one-time fragment credential: ${value}`);
  }
  return url;
}

export async function assertPortReusable(port: number): Promise<void> {
  await new Promise<void>((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => error === undefined ? done() : reject(error));
    });
  });
}
