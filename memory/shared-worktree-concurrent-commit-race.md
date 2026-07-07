---
name: shared-worktree-concurrent-commit-race
description: 多个 agent 共用一个工作树时 git add → commit 两步之间有竞态——另一 agent 的 commit 会把你暂存的文件连同它的改动一起带走;提交要用 git commit <paths> 一步完成
metadata:
  type: infra-bug
---

# 共享工作树多 agent 并发:git add 后再 commit 有竞态,暂存文件会被别人的提交带走

## 现象

2026-07-07 在 main 直推工作流下,agent A `git add` 了五个文件(AGENTS.md、memory/INDEX.md、两个测试等),
随后 `git commit` 报 "no changes added to commit"。查 `git show --stat HEAD` 发现这五个文件已经出现在
agent B 刚落的 `039c7e3 docs(diff-pages): ...` 里——B 的提交信息只描述自己的 diff-pages 工作,
A 的改动被静默捎带,提交历史的归因和叙事都被打乱。

## 根因

同一个工作树只有一份 `.git/index`(暂存区)。`git add` 与 `git commit` 是两步,任何在这个窗口里执行
`git commit`(不带 pathspec)的进程都会把**当时暂存区里的一切**做成提交——不管是谁 add 的。
多 agent 并行开发同一工作树时,这个窗口随时会被别人的提交穿过。

## 修法

- 提交自己的改动时不要走先 `git add`、隔几步再 `git commit` 的流程,用 **`git commit <path>...`(带 pathspec)一步完成**:
  它只提交指定路径的工作树内容,不受暂存区里别人(或自己残留)的条目影响,也不会捎走别人 add 的东西。
  注意 pathspec 只认**已跟踪**文件,新文件会报 `pathspec ... did not match any file(s) known to git`——
  新文件用 `git add <新文件> && git commit -- <全部路径>` 在同一条 shell 命令里完成,把竞态窗口压到毫秒级。
- 发现自己的文件被别人的提交带走时:内容已在 main 上,**不要**用 rebase / reset 拆历史(工作树里还有
  别人进行中的工作,重写历史会相互践踏);在自己下一个提交的信息里说明归属即可。
- 适用场景:所有多 agent 共用一个 checkout 的仓库;单人单 agent 不受影响。
