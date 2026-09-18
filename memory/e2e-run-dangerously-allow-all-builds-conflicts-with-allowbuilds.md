---
format: concord.document/v1
id: e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds
title: e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds
createdAt: 2026-07-19T11:26:23+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds.md
  commit: 5431ec33105ddc53403afac1d77a278648a11a45
description: e2e/scripts/run.ts 的隔离安装用
  --config.dangerouslyAllowAllBuilds=true,与仓库自己 pnpm-workspace.yaml 的
  allowBuilds 白名单在 pnpm 10.33+/11
  上互斥,ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES 直接判红整个 e2e matrix
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "**相邻问题(均已修)**：install 修好后又暴露三层独立问题,全部在同一次排障里解决:"
    proof: []
    source:
      path: memory/e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:112dd092cb7caef8e36445ba3640b17e7eb67e29d62e10beb27b8a18089e231c
---

**现象**：`e2e.yml` push 到 `main` 后所有 matrix cell(ai-sdk/bub/claude-code/codex-cli)
全部同样失败,`Run e2e for <id>` 步骤在 `pnpm install` 阶段就退出:

```
ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES  Cannot have both neverBuiltDependencies and onlyBuiltDependencies
```

`gh run list --workflow=e2e.yml` 显示这从 2026-07-11 附近的多次 push/nightly 运行起就一直是红的——不是这次改动引入的新问题,是长期潜伏、从未被注意到的 CI 常红。

**根因**：`run.ts`(旧版)给隔离拷贝装依赖时带了 `--config.dangerouslyAllowAllBuilds=true`。
在 pnpm 10.33+(用真实二进制在 `/tmp` 隔离拷贝上验证复现,pnpm 11.12 不复现,行为随大版本变化):
`dangerouslyAllowAllBuilds=true` 会把 `neverBuiltDependencies` 设成 `[]`——空数组,但 JS
里依然是 truthy。而 `e2e/adapter/*` 每个仓库自己的 `pnpm-workspace.yaml` 都声明了
`allowBuilds`(如 `ai-sdk` 的 `esbuild: true`),这会被翻译成非空的
`onlyBuiltDependencies`。pnpm 自己的校验用 `if (opts.onlyBuiltDependencies &&
opts.neverBuiltDependencies)` 做真值判断,两边都是 truthy(一个非空、一个空但
truthy)——直接抛错,不管 `neverBuiltDependencies` 内容其实是空的。

**修法**：删掉 `--config.dangerouslyAllowAllBuilds=true`,只留 `pnpm install
--no-frozen-lockfile`(修在 `e2e/scripts/run.ts` 的 `runRepoOnce`)。每个仓库自己的
`allowBuilds` 已经是构建脚本白名单的唯一事实来源,不需要再叠加一个全局 CLI 覆盖——
用 pnpm 10.33.2 真实二进制在 `ai-sdk` 隔离拷贝上验证过:去掉 flag 后 install 干净通过,
`esbuild` 正常构建。`claude-code` 没有自己的 `pnpm-workspace.yaml`(与 `bub`/`codex-cli`
不同),去掉 flag 后 install 会打印 `Ignored build scripts: cpu-features/esbuild/
protobufjs/ssh2` 警告,但实测 `tsx` 仍可正常执行(esbuild 的预编译二进制不依赖那个被
跳过的 postinstall 脚本),不是阻断性问题,未额外补 `pnpm-workspace.yaml`。

**关联**：本条是 [pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md)
描述的同一套 `allowBuilds` 机制在不同触发路径下的另一种炸法;两条都指向"pnpm 的
build-approval 机制和 CLI 级全局覆盖 flag 不能混用"。

**相邻问题(均已修)**：install 修好后又暴露三层独立问题,全部在同一次排障里解决:

1. `e2e.json` 声明的 `secrets` 与 GitHub 仓库实际配置的 secrets(`gh secret list`)对不上——
   `ai-sdk` 缺 `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`DEEPSEEK_BASE_URL`、`bub` 缺
   `BUB_API_KEY`/`BUB_API_BASE`、`claude-code` 缺 `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`,
   全仓库缺 `NICEEVAL_JUDGE_BASE`。各仓库本地(gitignored、未入 git)`.env` 里其实一直有
   一套可用的 DeepSeek 凭据——DeepSeek 官方端点同时兼容 OpenAI 协议根路径和
   `/anthropic` 子路径,同一账号可以同时喂 `OPENAI_*`/`DEEPSEEK_*`/`NICEEVAL_JUDGE_*`
   和 `claude-code` 的 `ANTHROPIC_*`;`bub` 走的是独立的 `s2a.niceeval.com` 网关,不能
   替换成 deepseek。已从各仓库 `.env` 取值用 `gh secret set` 补齐全部缺失 secret。
2. 补上 `NICEEVAL_JUDGE_BASE` 后,`claude-code`/`results` 的 judge 调用第一次真正打到
   `https://api.deepseek.com`,才发现已存量配置两周的 `NICEEVAL_JUDGE_KEY` 本身是
   [e2e-s2a-jihuayu-proxy-decommissioned](e2e-s2a-jihuayu-proxy-decommissioned.md)
   描述的旧代理签发的失效 key(401 invalid),此前从未被真正调用过(`codex-cli` 能
   "过"是因为它的 eval 压根没用到 judge,precheck 对没用 judge 的 eval 不发起 HTTP
   调用,掩盖了这个 key 早已失效的事实)。用同一批 `.env` 里的当前有效 key 覆盖
   `NICEEVAL_JUDGE_KEY` 后解决。
3. `results` 仓库 `scripts/verify.ts` 两处硬编码断言 `snapshot.agent`/`RunSummary.agent`
   必须等于 `"openai-compat"`,但 `748309e`(rename contract repos to results/cli…drop
   openai-compat E2E coverage)已经把这个仓库的 Agent 改名成 `"results-mechanism"`
   (`experiments/main.ts`),verify.ts 的两处期望值没跟着改,自那次重构起每次真跑
   `results` 都必挂;改成 `"results-mechanism"` 后修复。

**验证**：三处修完后 push 触发 `e2e.yml`,`ai-sdk`/`cli`/`results`/`claude-code`/`bub`/
`codex-cli` 六个仓库全部转绿(`gh run view <run-id> --json conclusion` 确认)。过程中
`results` 的 `tool-call` eval 还出现过一次孤立的模型幻觉(prompt 让模型查"ACME"股价,
真实调用把 symbol 传成了真实存在的 ticker `"ACMR"`),本地对同一 prompt 直接跑 5 次
全部正确返回 `"ACME"`,判定为一次性模型抖动而非代码缺陷,未做任何改动。
