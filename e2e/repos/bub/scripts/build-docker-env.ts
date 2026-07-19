#!/usr/bin/env -S npx tsx
// scripts/build-docker-env.ts — 构建本仓库的预制 Docker 环境
// (docs/feature/sandbox/library/prebuilt-environments.md「Docker:Dockerfile 派生」)。
//
// node:24-slim 默认没有 curl/git/ca-certificates,而 bub 的安装(uv 装 python 工具链 +
// git+https 依赖)三者都要用到——见 docker/Dockerfile 的注释。构建归 provider 原生工具
// (这里就是 `docker build`),experiment 只消费产物 tag(niceeval.config.ts 的
// `dockerSandbox({ image: IMAGE_TAG })`)。
//
// 幂等:tag 已存在时跳过构建,除非传 --force 或设 BUB_E2E_REBUILD_IMAGE=1
// (改了 Dockerfile 后要重建时用)。产物只在本机 Docker daemon 有效(单机构建,单机消费),
// 与 e2e.json 的 requires.docker 对应。

import { spawnSync } from "node:child_process";

export const IMAGE_TAG = "niceeval-bub-e2e:local";

function imageExists(tag: string): boolean {
  const res = spawnSync("docker", ["image", "inspect", tag], { stdio: "ignore" });
  return res.status === 0;
}

export function ensureDockerImage(opts: { force?: boolean } = {}): void {
  const force = opts.force ?? (process.argv.includes("--force") || process.env.BUB_E2E_REBUILD_IMAGE === "1");
  if (!force && imageExists(IMAGE_TAG)) {
    console.log(`[build-docker-env] ${IMAGE_TAG} already present, skipping build (pass --force to rebuild).`);
    return;
  }
  console.log(`[build-docker-env] building ${IMAGE_TAG} from docker/Dockerfile ...`);
  const res = spawnSync("docker", ["build", "-t", IMAGE_TAG, "docker"], { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`docker build failed (exit ${res.status ?? -1}) — see output above.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    ensureDockerImage();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}
