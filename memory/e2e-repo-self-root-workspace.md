---
format: concord.document/v1
id: e2e-repo-self-root-workspace
title: e2e-repo-self-root-workspace
createdAt: 2026-07-21T19:45:01+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2e-repo-self-root-workspace.md
  commit: cde9590883d29ffe1924f6edb8c42b76665a4f42
description: E2E 每个测试仓库必须带 packages:[] 的 pnpm-workspace.yaml 自成 workspace root
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---

每个 `e2e/adapter/*` 与 `e2e/cli`、`e2e/report` 测试仓库都要带一份只含 `packages: []` 的 `pnpm-workspace.yaml`,让 pnpm 把仓库目录本身当 workspace root、不向上并入父级 workspace。否则就地调试(`cd e2e/adapter/<id> && pnpm install && pnpm e2e`,`e2e/README.md` 明列为支持流程)时 pnpm 会走到 niceeval 根 `pnpm-workspace.yaml`,绕过候选 tarball 注入的隔离。`allowBuilds`(原生构建开关,如 esbuild、dockerode 的 ssh2/cpu-features)也放这个文件。

**为什么记**:曾经 6 个仓库里只有 `ai-sdk`/`bub`/`codex-cli` 带这文件,`claude-code`/`cli`/`results` 缺;而 `run.ts` 注释还把「each repo declares allowBuilds in pnpm-workspace.yaml (README §2.1)」当成既有约定——但 docs §2.1 当时根本没写这条,是个「好设计只活在部分仓库注释里、docs 沉默」的漂移。裁决:隔离意图为准,补齐三个仓库 + 把契约升进 docs §2.1/§8 + 加结构守护(`test/e2e-structure.test.ts` 的 `declaresEmptyWorkspacePackages`)。编排器路径(`run.ts` 拷到 `os.tmpdir()`)因为临时目录没有祖先 workspace 本就免疫,所以 CI 一直是绿的,漏洞只在就地调试路径——这也是为什么长期没被发现。

**如何应用**:新增 E2E 测试仓库时,`pnpm-workspace.yaml` 是必备文件(与 package.json/lockfile 同级),`packages: []` 是硬性内容,不是可选优化。属于 [[e2e-repo-autonomy-replaces-shared-suite]] 的仓库自治契约的一部分;与旧架构下 `e2e/pnpm-workspace.yaml` 顶掉子仓库 install 的 [[e2e-repos-stale-pnpm-workspace-hijacks-lockfile]] 是同一根隔离问题在新架构下的正解(那条用 `--ignore-workspace` 兜,这条用每仓库自成 root 从源头切断)。
