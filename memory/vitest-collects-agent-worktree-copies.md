# vitest 把 agent 临时 worktree 里的旧源码副本当成正式测试跑

## 现象

`pnpm test` 报 113 个测试文件 / 1089 个测试，但 `src/` 和 `test/` 下实际只有 53 个测试文件。多出来的 60 个文件全部来自 `.claude/worktrees/` 下 4 个废弃的 agent worktree，每个都含一整份 `src/` 副本。

它们**全绿**，所以从来没人注意到。这恰恰是问题：它们跑的是各自 worktree 那一刻的旧源码（审计时 main 在 `4883d8e`，4 个 worktree 全钉在 6 天前的 `4d12350`），因此

- 不可能抓到当前代码的任何回归；
- 却可能因为与本次改动完全无关的陈旧原因把 CI 弄红。

45% 的测试时间花在这上面（7.2s → 3.8s）。

## 根因

两层叠加：

1. `.claude/worktrees/` 被 `.git/info/exclude` 忽略，所以 `git status` 里**完全看不见**它们——人的那条发现路径是断的。
2. `vitest.config.ts` 的 `exclude` 里已经有 `.repos/**`（vendored 外部仓库，同一类问题），但没有 `.claude/**`。vitest 的文件发现不看 gitignore，它照收不误。

即：git 的可见性和 vitest 的收集范围是两套独立规则，前者把目录藏起来，后者把它捡回来，中间没人对账。

## 修法

`vitest.config.ts` 的 `exclude` 补上 `.claude/**`（跟 `.repos/**` 并列，理由同类）。

废弃 worktree 本身用 `git worktree prune` + 删目录清掉，但**不能只做这一步**——下次 agent 再开 worktree 问题就回来了。配置里的 exclude 才是根治。

一条可复用的对账判据，已升格进 [`docs/engineering/unit-tests/README.md`](../docs/engineering/unit-tests/README.md)「套件边界」：**`pnpm test` 报出的文件数应当等于 `src/` + `test/` 下测试文件的实际数量，对不上就是收进了不该收的东西。**

发现于 2026-07-13 的测试套件审计，见 [[test-budget-inverted-pyramid]]。
