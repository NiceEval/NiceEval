---
{
  "format": "niceeval.feedback/v1",
  "id": "20260821150630-niceeval-的-git",
  "title": "NiceEval 的 Git dependency prepare 在无 .git 的包缓存中失败",
  "state": "open",
  "reportedAt": "2026-08-21T15:06:30+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: 'NiceEval 的 Git dependency prepare 在无 .git 的包缓存中失败'\nseverity: 'major'\n---\n\n## Expected Behavior\n\nConsumer 可把 NiceEval 钉到公开 Git commit；pnpm 在包缓存中完成构建，非 Git 环境跳过 Husky 配置。\n\n## Current Behavior\n\nprepare 完成 build:package 与 build:index 后，`scripts/configure-husky.mjs` 执行 `git rev-parse --git-common-dir`。codeload tarball 没有 `.git`，安装以 `ERR_PNPM_PREPARE_PACKAGE` 失败。\n\n## Possible Solution\n\nconfigure-husky 在非 Git package 环境直接跳过，同时保留 package build。\n\n## Minimal Reproducible Example\n\n在 consumer 的 package.json 中加入 `niceeval: https://github.com/NiceEval/NiceEval.git#69b42445c71727c485754b87997bc00c401f1ba9`，在 pnpm allowBuilds 允许该精确依赖，然后运行 `pnpm install --lockfile-only`。\n\n## Context\n\n这阻止下游在正式 npm release 之前用精确 Git SHA 做可重现 CI/Netlify dogfood；本机 link 和另行分发 tarball 都不适合云端 PR preview。\n",
  "impact": "prepare 完成 build:package 与 build:index 后，`scripts/configure-husky.mjs` 执行 `git rev-parse --git-common-dir`。codeload tarball 没有 `.git`，安装以 `ERR_PNPM_PREPARE_PACKAGE` 失败。",
  "memoryRelations": []
}
---
---
title: 'NiceEval 的 Git dependency prepare 在无 .git 的包缓存中失败'
severity: 'major'
---

## Expected Behavior

Consumer 可把 NiceEval 钉到公开 Git commit；pnpm 在包缓存中完成构建，非 Git 环境跳过 Husky 配置。

## Current Behavior

prepare 完成 build:package 与 build:index 后，`scripts/configure-husky.mjs` 执行 `git rev-parse --git-common-dir`。codeload tarball 没有 `.git`，安装以 `ERR_PNPM_PREPARE_PACKAGE` 失败。

## Possible Solution

configure-husky 在非 Git package 环境直接跳过，同时保留 package build。

## Minimal Reproducible Example

在 consumer 的 package.json 中加入 `niceeval: https://github.com/NiceEval/NiceEval.git#69b42445c71727c485754b87997bc00c401f1ba9`，在 pnpm allowBuilds 允许该精确依赖，然后运行 `pnpm install --lockfile-only`。

## Context

这阻止下游在正式 npm release 之前用精确 Git SHA 做可重现 CI/Netlify dogfood；本机 link 和另行分发 tarball 都不适合云端 PR preview。
