---
format: concord.document/v1
id: judge-config-precheck-hard-fails-without-key
title: judge-config-precheck-hard-fails-without-key
createdAt: 2026-07-03T05:24:42+08:00
createdAtSource:
  kind: first-recorded
  path: memory/judge-config-precheck-hard-fails-without-key.md
  commit: eb582131f9cc4cccadc48a5a769e9b65062873b8
description: niceeval.config.ts 里显式设 judge.model 后,没有对应 API key 会在跑任何 eval 前直接抛错退出,不是"judge 断言自动跳过"
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
    statement: "- 已修 [judge-config-precheck-hard-fails-without-key](judge-config-precheck-hard-fails-without-key.md) — 显式设 `judge.model` 后没有对应 API key 曾是跑前直接抛错退出;现预检只对「实际要跑且源码含 judge」的 eval 生效(修在 `src/runner/run.ts` judgeProbeTargets)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：`examples/zh/eval/claude-agent-sdk/niceeval.config.ts` 按 ai-sdk-v7 的写法设了
`judge: { model: "gpt-5.4" }`。在没有可用 `OPENAI_API_KEY`(沙箱里因数据外发限制没法用
`examples/zh/eval/ai-sdk-v7/.env` 那个 `s2a.jihuayu.site` 网关凭据)的情况下跑
`niceeval exp <name>`,还没进任何 eval 就直接报错退出：

```
· prechecking judge config...
niceeval error: Error: judge model gpt-5.4 is missing an API key; configure NICEEVAL_JUDGE_KEY / OPENAI_API_KEY
```

这跟 `docs-site/zh` 和多个示例 README 里写的"没有 judge API key 时,judge 断言自动跳过,
确定性断言照常跑"不一致——那句话描述的是 `buildJudge`(`src/scoring/judge.ts:160-163`,没
key 直接返回 `noOpJudge()`,单条断言层面确实会静默跳过)的行为,但 `runEvals`
(`src/runner/run.ts:90-108`)在**跑任何 eval 之前**还有一轮独立的 judge 预检:只要
`config.judge` 或任意 `evalDef.judge` 是非空对象就会调 `probeJudge`,key 缺失时直接
`throw`,整个进程退出,不会进入"确定性断言照常跑"的宽容路径。

**根因**：预检(fail fast,避免跑完 agent 才发现 judge 不通)只看"有没有显式配置 judge
对象",不看"这次运行会不会实际触发 judge 断言"。`buildJudge` 的宽容降级只在预检通过之后
才生效,两层行为不一致,文档只写了后一层。

**修法（2026-07-07,已落地）**：预检目标收敛为「本次实际要跑、且 eval 源码里出现
`judge` 字样」的 eval 的生效配置(`evalDef.judge ?? config.judge`,与 attempt 的
resolveJudge 一致)。全局配了 judge 但选中的 eval 都不用时整个跳过探测;全部结果
携入(attempts 为空)时也跳过。落点 `src/runner/run.ts` 的 `judgeProbeTargets`,
守护测试 `src/runner/run.test.ts`。源码扫描是启发式:judge 调用藏在 import 的
helper 里会漏判,漏判只是退回旧行为(评分时才报 judge 错误),不影响正确性。

**修前的绕法 / 适用场景**：
- 如果要在没有可用 judge key 的环境里(CI、沙箱、离线开发)验证一个新示例的确定性断言
  链路,**必须**先把 `niceeval.config.ts` 里的 `judge: {...}` 整行注释掉(或整个 config
  文件里不出现 `judge` 字段),而不是指望"没 key 会自动跳过"。跑完验证后再加回来。
- 如果 `.env` 里的 judge key 是能真实用的(比如 `examples/zh/eval/ai-sdk-v7` 那个
  `OPENAI_API_KEY=...s2a.jihuayu.site` 网关凭据),保留 `judge.model` 配置没问题——只是
  在这类会拦截"新写入的凭据外发到未知域名"的沙箱执行环境里,第一次针对该凭据的真实调用
  会被 auto-mode 分类器拦下(见 `origin-examples-real-ai-credentials.md`),需要用户本人在
  非沙箱环境或显式放行后才能验证 judge 那部分。
- 已确认踩过:`examples/zh/eval/claude-agent-sdk`(2026-07-02,新建示例验证阶段发现)。
