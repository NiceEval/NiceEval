# claude-code 的原生 Skill 工具叫 `Skill`,不是 `load_skill`;`t.loadedSkill()` 断不中

**现象**：给 `claudeCodeAgent` 装了一个真实 skill(`Effect-TS/skills`)、发一句会触发它的提示词,
`t.loadedSkill("effect-ts")` 断言仍然失败(0 分),即使从回复内容看模型明显读过 skill 文件。

**根因**：`t.loadedSkill(skill)` 是 `t.calledTool("load_skill", { input: { skill } })` 的语法糖
(`src/scoring/scoped.ts`),这是为 eve 协议量身定的糖——eve 的 action kind 真的叫 `load-skill`
(见 `docs/adapters/reference/eve-protocol.md`)。claude-code CLI 的原生工具用的是完全不同的名字
`Skill`(首字母大写),入参形状是 `{ skill: "<id>", args: "<自然语言摘要>" }`,`calledTool` 按
`tc.name === name || tc.originalName === name` 匹配(`src/scoring/scoped.ts` 的 `toolMatches`),
"load_skill" 两边都对不上 claude-code 的 "Skill"。

实测(Docker 沙箱,`claude --print --dangerously-skip-permissions`,装了 `Effect-TS/skills` 后问
Effect 的 Layer 用法):transcript 里的 tool_use 是
`{"name":"Skill","input":{"skill":"effect-ts","args":"..."}}`,随后跟一次
`Read` 读 `.claude/skills/effect-ts/references/guide-layers.md`。

**当时的修法**(使用侧绕行):claude-code 的 skill 断言直接写
`t.calledTool("Skill", { input: { skill: "effect-ts" } })`,不要用 `t.loadedSkill()`。
落点：`e2e/shared/evals.ts` 的 `skillUsed(p)` factory(`profile.skillDetection === "tool"` 分支)。

**最终修法**(2026-07-12,改的是 `loadedSkill` 本身):绕行方案把「按工具名猜」的负担推给了 eval 作者,
而 Skill 加载早已在别处被定为一等事件——`skill.loaded`(`src/o11y/types.ts`),claude-code parser
也已经把 Skill 的 `tool_use` 直接归一成它、并吃掉配对的 tool_result(`src/o11y/parsers/claude-code.ts`)。
于是 `loadedSkill()` 那个 `calledTool("load_skill")` 糖在 claude-code 上**永远匹配不上**:parser 根本
不再产出名叫 `load_skill`(或 `Skill`)的 `action.called`。修为 `loadedSkill()` 直接读 `skill.loaded`
事件(`src/scoring/scoped.ts`),归一的责任回到 adapter/parser 手里,eval 作者照常写
`t.loadedSkill("effect-ts")`。契约同步进 `docs/feature/adapters/contract.md`(Skill 加载是一等事件,
伪装成 `action.called` 是 adapter 违约)与 `docs/assertions.md`。

**教训**:同一个概念在事件层已经升成一等公民、断言层却还留着旧的「按名字猜」实现,这种半截迁移
比两边都旧更危险——它在类型上、文档上都看不出问题,只在真跑一次 claude-code 时静默断不中。

适用场景:任何要断言"agent 真的用了某个 skill"的 eval。

关联:[[npx-skills-add-headless-hang]](同一次调研)、
[[codex-no-native-skill-tool]](codex 那边完全没有对应工具,情况更极端)、
[[skill-loaded-input-field-is-skill-not-command]](同一次 `skill.loaded` 归一化的另一处踩坑)。
