# bub:模板烘焙的二进制击穿 git-pinned override,修复分支从未被安装

## 现象

e2b 模板 `fasteval-agents` 上整轮 bub attempt `turn 1 ← failed`(部分 0 tools · 0 tok,
即 send 后无 AI 回复)——尽管 `BUB_OVERRIDE` 已钉在修好该问题的
`fix/tape-assistant-text-with-tool-calls` 分支,且 niceeval 已带 `9bb069a`/`7dc9126`。
下游 coding-agent-memory-evals 的 compare 重跑(2026-07-10)确定性复现:18 个 bub
attempt 几乎全灭,claude/codex 同沙箱正常。

## 根因

两处叠加,`src/agents/bub.ts`:

1. `ensureBub` 开头 `command -v bub` 命中(模板把 bub 烘焙在 /usr/local/bin)就直接
   return——uv 安装 + override 全套被跳过,修复分支从未落地;
2. `BUB` 常量本身也是 `$(command -v bub || …)`,就算装了新的,PATH 上 /usr/local/bin
   的旧构建仍先被找到。

模板构建时间早于 override ref 当前指向的 commit 时,烘焙货必然是旧的;`INSTALL_HASH`
缓存键含 spec 不含 commit,分支移动本来就靠"换分支名 bust",而模板捷径连这层都绕过了。

## 修法

`BUB_PINNED = BUB_OVERRIDE.includes("git+")`:pinned 时 (a) ensureBub 不走模板捷径,
恒按 override 经 uv 安装(有 checkpoint 缓存,非每沙箱全量装);(b) `BUB` 钉死
`$HOME/.local/bin/bub`。非 pinned(发布版)行为不变,模板捷径保留。

适用判断:任何"沙箱里已有就跳过安装"的捷径,遇到 git-ref 级 pin 都要失效——
烘焙产物无法验证与 ref 当前指向一致。同理适用于未来给其它 agent 加模板捷径时。
根治是模板重建后把 override 撤回发布版(见文件头 TODO)。
