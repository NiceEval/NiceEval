# prompt A/B 变体不能顺带改松工具纪律

- **现象**:`examples/zh/tier3/pi-sdk` 的 compare-prompts 实验里,「极简风格」systemPrompt 变体第一版只写「需要时调用工具」,模型在「极简」的暗示下对算式直接心算作答、跳过 `calculate` 工具,HITL 停轮没有发生,`hitl-deny` 这条 eval 直接 `errored`。看起来像采集或 adapter 问题,实际是 prompt 变体自己引起的行为变化。
- **根因**:tier3 的 `systemPrompt` 是整份替换(不是追加)。A/B 想对照的是风格,但替换时把默认 prompt 里的工具纪律一起改松了——变体间差异不再是单变量,工具类断言(`t.calledTool` / HITL 流程)随之失真。
- **修法**:变体 prompt 把「涉及算式必须调用 calculate……不要心算、不要瞎编数字」写死,保证工具规则至少和默认 prompt 一样硬;落点 `examples/zh/tier3/pi-sdk/experiments/compare-prompts/concise.ts`(文件内注释记录同一教训)。适用场景:任何整份替换 systemPrompt 的 prompt A/B 实验,设计变体时先核对默认 prompt 里有哪些行为纪律必须原样保留。
