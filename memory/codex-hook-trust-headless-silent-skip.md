---
format: concord.document/v1
id: codex-hook-trust-headless-silent-skip
title: codex hook 信任门槛在 headless 下静默跳过所有非 managed hook
createdAt: 2026-07-17T14:12:36+08:00
createdAtSource:
  kind: first-recorded
  path: memory/codex-hook-trust-headless-silent-skip.md
  commit: 177a151c4b41ba97515f17af597b1f91c23a9cac
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
    statement: "- 已修
      [codex-hook-trust-headless-silent-skip](codex-hook-trust-headless-silent-\
      skip.md) — codex 对非 managed hook 要求交互式授信,headless 下未授信 hook 被静默跳过零报错(插件
      hook 配置全对也零触发);bypass_hook_trust 是 runtime-only,修为 exec 一律带
      `--dangerously-bypass-hook-trust`(src/agents/codex.ts)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# codex hook 信任门槛在 headless 下静默跳过所有非 managed hook

## 现象

E2B 沙箱里经 `plugins` + `postSetup`（跑插件自带 `install_hooks.py`）装好的 codex hook（nowledge-mem 的 SessionStart 注入 / Stop 捕获）零调用、零报错。配置侧全部正确可核对：插件装上、`[features]` 的 hooks/plugins 开着、hook state enabled、全局 hooks.json 就位、MCP 段正常（codex 0.144.1，`codex mcp list` 可列出）。下游 coding-agent-memory-evals 三轮沙箱排查实锤（2026-07-17）。

## 根因

codex 对非 managed 来源的 hook 要求 trusted_hash 匹配，信任只能交互式授予（插件安装脚本尾行 "restart Codex and trust the hooks when prompted" 说的就是这个）。headless `codex exec` 下未授信 hook 被**静默跳过**，没有任何日志或错误——「配置全对但 hook 零触发」的全部原因。

`bypass_hook_trust` 是 runtime-only，`config.toml` 设不了。唯一非交互出口是 `codex exec --dangerously-bypass-hook-trust`（codex 源码注释："Intended only for automation that already vets hook sources"——eval 沙箱正是这种场景）。0.144.1 实测带 flag 后 Stop hook 立即生效，线程被捕获到服务端。

## 修法

`codexAgent` 的 `send()` exec flags 一律带 `--dangerously-bypass-hook-trust`（首轮与 resume 相同；修在 `src/agents/codex.ts`）。不加开关：沙箱内每个 hook 来源都由实验配置显式声明（`plugins` / `postSetup` / `configFile`），声明即审计，与既有的 `--dangerously-bypass-approvals-and-sandbox` 同一信任层级。契约声明在 `docs/feature/adapters/sdk/codex-cli/README.md`「执行信任姿态」。

注意版本面：flag 需要较新的 codex（0.144.1 确认支持）；预制模板若烘焙了更老的 codex，unknown flag 会让 exec 直接报错——这属于显式失败，比静默跳过好定位，升级模板内 codex 即可。
