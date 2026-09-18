---
format: concord.document/v1
id: cli-exp-multi-experiment-positional-noop
title: "`niceeval exp <a> <b>` 不会跑两个实验,第二个 positional 被当成 eval 过滤器"
createdAt: 2026-07-11T18:52:06+08:00
createdAtSource:
  kind: first-recorded
  path: memory/cli-exp-multi-experiment-positional-noop.md
  commit: 7114c5fc404aa72ea9a228a3c7b98050e53c4ca8
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
    statement: "- 已修:`docs-site/{,zh/}example/claude-code-codex-{skill,plugin}.mdx`
      里的示例命令(原来的"
    proof: []
    source:
      path: memory/cli-exp-multi-experiment-positional-noop.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:0e965a17928cc2fd41728b1169d892399343193d97994876f9fc1a6d847bd90a
---
# `niceeval exp <a> <b>` 不会跑两个实验,第二个 positional 被当成 eval 过滤器

## 现象

文档(docs-site 的 codex-skill/plugin 示例、`examples/zh/coding-agent-skill` 旧 README)写
`pnpm exec niceeval exp ponytail ponytail-baseline` 期望一条命令跑两个实验,实测输出
`Running 0 evals`——一个 eval 都没跑,也不报错,像是安静地什么都没做。

## 根因

`src/cli.ts` 的 `exp` 分支只取 `positionals[0]` 当实验/组选择器(`expArg`),`positionals.slice(1)`
一律是 `extraPatterns`(eval id 前缀过滤),经 `evalsFilterFromExperiment` 与实验自己的 `evals` 过滤器
取交集。`ponytail-baseline` 是另一个实验的 id,不是任何 eval 的 id 前缀,于是过滤结果为空集,
静默跑 0 个 eval 退出码却是 0——不报"实验不存在"这类明显错误,很容易被读成"跑完了、正好没匹配"。

多个实验能一条命令跑,只有一种合法路径:它们的文件同在一个子目录下,共享 `group`(目录名),
`niceeval exp <group>` 按 `e.group === expArg` 匹配全部成员(`compare-models`、`experiments/compare/*`
都是这个用法)。**没有**"传多个 flat 实验 id 当 group 用"的等价写法。

## 修法

- 要跑多个不共享目录的 flat 实验文件,分开发多条 `niceeval exp <id>` 命令(能顺序执行也能各自
  `--runs`/`--budget` 单独调),不要塞进一条命令的多个 positional。
- 已修:`docs-site/{,zh/}example/claude-code-codex-{skill,plugin}.mdx` 里的示例命令(原来的
  `niceeval exp ponytail ponytail-baseline`、`niceeval exp compare` 都是从没跑通过的示例)。
- 判别技巧:`Running 0 evals` 且 experiment 表是空表,先怀疑这条命令本身传参有误,不要先怀疑
  实验定义或环境。
