---
format: concord.document/v1
id: gen-diff-code-run-residue-and-stale-claims
title: gen-diff-code:运行残留混进 diff 页 + intro 里的事实声明会过期
createdAt: 2026-07-03T20:16:57+08:00
createdAtSource:
  kind: first-recorded
  path: memory/gen-diff-code-run-residue-and-stale-claims.md
  commit: e842f5e0d2544cd1091af51a10a0c0c490f2458d
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: '- codex pair 的 `exclude` 加了 `"workspace"`(2026-07 已修);新增会产生运行产物的'
    proof: []
    source:
      path: memory/gen-diff-code-run-residue-and-stale-claims.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:ab349c8c8f6ebc62609e209b53b29a4a642ec41592d77e954657fa03333ce36a
---
# gen-diff-code:运行残留混进 diff 页 + intro 里的事实声明会过期

## 现象

1. `docs-site/zh/example/codex-sdk-before-after.mdx` 的文件清单里出现了
   `workspace/niceeval-create-file.txt`(新增)——这是 create-file eval 跑一次留下的
   scratch 产物,却出现在一个宣称"应用侧一行没改"的 before/after 页里。
2. `ai-sdk-v7-before-after.mdx` 的 intro 引用了 `examples/zh/ai-sdk-v7`(不存在;tier
   重构后实际路径是 `examples/zh/tier1/ai-sdk-v7`),还宣称它是"内建 aiSdkAgent 进程内
   直调"的可跑示例——实际那个目录的 evals 在 "add tier" 提交里被删了,现在和
   `origin/ai-sdk-v7` 逐字节相同,是待重接状态。

## 根因

1. `scripts/gen-diff-code.ts` 的 `listFiles` **不读 .gitignore**,只认脚本里的全局
   `EXCLUDES` 和 pair 级 `exclude`。codex 的 `workspace/` 在两个目录的 .gitignore 里都
   写了"纯 scratch 不进版本库",但脚本不知道;eval 每跑一次就会往 tier1 侧写新文件,
   下次 `gen:diff-code` 就把残留当成"接入新增的文件"。
2. PAIRS 的 `intro` 是手写叙述,里面的路径/能力声明不参与任何校验(docs:links 只查
   docs-site 内部链接,不查"仓库里另有一份 XXX"这类文字声明),仓库重构后会静默失真。

## 修法

- codex pair 的 `exclude` 加了 `"workspace"`(2026-07 已修);新增会产生运行产物的
  eval 时,对应 pair 要同步排除产物路径,或者直接让 `listFiles` 尊重 .gitignore。
- 跑完 `gen:diff-code` 后自查:生成页的文件清单里不该出现任何 eval 运行产物;intro
  里引用的每个仓库路径先 `ls` 核实存在、描述与当前实态一致。
- 后续(同日):用户裁定 Tier 1 统一为黑盒/OTel 接入——那份 origin 纯副本 `tier1/ai-sdk-v7`
  已删除,黑盒版 `ai-sdk-v7-http` 改名顶上,现在 `tier1/ai-sdk-v7` 就是黑盒 HTTP 接入版,
  五个应用全部同名配对。内建 aiSdkAgent 直调路数只在 docs-site 指南里讲,不做 Tier 1 示例。
  另一条同场景铁律:适配副本**不能改 package.json 的 `name`**(必须和 origin 完全一致,
  diff 页里出现 name 改动就是违规)。
