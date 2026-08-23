---
{
  "format": "niceeval.feedback/v1",
  "id": "20260821172751-build-package-跨文件系统移动",
  "title": "build:package 跨文件系统移动 dist 时以 EXDEV 失败",
  "state": "open",
  "reportedAt": "2026-08-21T17:27:51+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: 'build:package 跨文件系统移动 dist 时以 EXDEV 失败'\nseverity: 'major'\n---\n\n## Expected Behavior\n\n`pnpm run build:package` 在 CI 的任意标准临时目录布局中完成，并把已构建 runtime 安全发布到仓库 `dist/`。\n\n## Current Behavior\n\n`scripts/package-runtime/build.mjs` 在系统临时目录构建后直接 `rename(temp/dist, repo/dist)`。当 `/tmp` 与 checkout 分属不同文件系统时，Node 抛出 `EXDEV: cross-device link not permitted`，Netlify 构建失败。\n\n## Possible Solution\n\n保持同文件系统的原子 rename；检测 `EXDEV` 时复制到目标文件系统内的临时目录，再原子替换，或默认把 staging 建在目标目录所在文件系统。\n\n## Minimal Reproducible Example\n\n在 `/tmp` 与 checkout 为不同 mount 的环境运行 `pnpm run build:package`。Netlify Noble build image 可稳定复现：`rename /tmp/niceeval-package-runtime-*/dist -> /opt/build/repo/dist` 返回 `EXDEV`。\n\n## Context\n\nPR report preview 目前通过为该命令设置 checkout 内的 `TMPDIR` 绕过；通用 `build:package` 仍受影响。\n",
  "impact": "`scripts/package-runtime/build.mjs` 在系统临时目录构建后直接 `rename(temp/dist, repo/dist)`。当 `/tmp` 与 checkout 分属不同文件系统时，Node 抛出 `EXDEV: cross-device link not permitted`，Netlify 构建失败。",
  "memoryRelations": []
}
---
---
title: 'build:package 跨文件系统移动 dist 时以 EXDEV 失败'
severity: 'major'
---

## Expected Behavior

`pnpm run build:package` 在 CI 的任意标准临时目录布局中完成，并把已构建 runtime 安全发布到仓库 `dist/`。

## Current Behavior

`scripts/package-runtime/build.mjs` 在系统临时目录构建后直接 `rename(temp/dist, repo/dist)`。当 `/tmp` 与 checkout 分属不同文件系统时，Node 抛出 `EXDEV: cross-device link not permitted`，Netlify 构建失败。

## Possible Solution

保持同文件系统的原子 rename；检测 `EXDEV` 时复制到目标文件系统内的临时目录，再原子替换，或默认把 staging 建在目标目录所在文件系统。

## Minimal Reproducible Example

在 `/tmp` 与 checkout 为不同 mount 的环境运行 `pnpm run build:package`。Netlify Noble build image 可稳定复现：`rename /tmp/niceeval-package-runtime-*/dist -> /opt/build/repo/dist` 返回 `EXDEV`。

## Context

PR report preview 目前通过为该命令设置 checkout 内的 `TMPDIR` 绕过；通用 `build:package` 仍受影响。
