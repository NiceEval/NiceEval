---
format: concord.document/v1
id: prompt-ab-variant-loosens-tool-discipline
title: prompt A/B 变体不能顺带改松工具纪律
createdAt: 2026-07-14T06:34:24Z
createdAtSource:
  kind: first-recorded
  path: memory/prompt-ab-variant-loosens-tool-discipline.md
  commit: 9bc491f611f24384a393cb61c1c77449807c4216
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
    statement: "- 已修 [prompt-ab-variant-loosens-tool-discipline](prompt-ab-variant-loosens-tool-discipline.md) — 整份替换 systemPrompt 的 A/B 变体会顺带改松工具纪律:模型心算跳过工具,HITL/calledTool 断言失真;变体里工具规则要写得和默认 prompt 一样硬(修在 tier3/pi-sdk concise.ts)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# prompt A/B 变体不能顺带改松工具纪律

- **现象**:`examples/zh/tier3/pi-sdk` 的 compare-prompts 实验里,「极简风格」systemPrompt 变体第一版只写「需要时调用工具」,模型在「极简」的暗示下对算式直接心算作答、跳过 `calculate` 工具,HITL 停轮没有发生,`hitl-deny` 这条 eval 直接 `errored`。看起来像采集或 adapter 问题,实际是 prompt 变体自己引起的行为变化。
- **根因**:tier3 的 `systemPrompt` 是整份替换(不是追加)。A/B 想对照的是风格,但替换时把默认 prompt 里的工具纪律一起改松了——变体间差异不再是单变量,工具类断言(`t.calledTool` / HITL 流程)随之失真。
- **修法**:变体 prompt 把「涉及算式必须调用 calculate……不要心算、不要瞎编数字」写死,保证工具规则至少和默认 prompt 一样硬;落点 `examples/zh/tier3/pi-sdk/experiments/compare-prompts/concise.ts`(文件内注释记录同一教训)。适用场景:任何整份替换 systemPrompt 的 prompt A/B 实验,设计变体时先核对默认 prompt 里有哪些行为纪律必须原样保留。
