# claude-code Skill tool_use 的 skill 名在 `input.skill`,不是 `input.command`

**现象**：实现 `skill.loaded` 一等事件时(`src/o11y/parsers/claude-code.ts` 的
`extractSkillName`),第一版按未经核实的推断把 skill 名字段写成 `input.command`,配套单测
(`claude-code.test.ts`)也跟着断言 `input: { command: "pdf" }`。类型检查和单测全绿,但字段名
是错的——如果真的接到装了 Skill 的 claude-code transcript,`extractSkillName` 永远返回
`undefined`,所有 Skill 调用会静默退化成普通 `action.called`(`tool: "unknown"`),`skill.loaded`
事件永远不会产生。

**根因**：仓库里其实已经有一条**实测**结论精确记录了正确形状——
`memory/claude-code-skill-tool-name-not-load-skill.md`(2026-07 早前一次 e2e 调研,Docker
沙箱跑真实 `claude --print`,装了 `Effect-TS/skills` 后触发 Skill 调用,transcript 里
tool_use 实测是 `{"name":"Skill","input":{"skill":"effect-ts","args":"..."}}`)——但实现
`skill.loaded` 这个 phase 时没有去检索这条已有 memory,凭对 Anthropic 官方 Skills 文档/博客的
印象反推,把 `skill` 猜成了 `command`。另外用 `/Users/ctrdh/Code/claude-code-sourcemap`
(本机一份 Claude Code CLI 的反编译/sourcemap 还原副本,`restored-src/src/tools/SkillTool/
SkillTool.ts`)交叉核实,`inputSchema` 明确是
`z.object({ skill: z.string(), args: z.string().optional() })`,`SKILL_TOOL_NAME = "Skill"`
(严格大小写)——与 memory 里的实测结论完全一致,双重确认。

**修法**：`extractSkillName(name, input)` 改成读 `get(input, "skill")`(不是 `"command"`);
`SKILL_TOOL_NAME` 仍保留大小写不敏感比较(`name.toLowerCase() !== "skill"`)作为防御性放宽,
不代表原生真的会变大小写。落点：`src/o11y/parsers/claude-code.ts`、
`src/o11y/parsers/claude-code.test.ts`。

**适用场景**：任何要凭空实现/修改"识别 claude-code 原生 Skill 调用"逻辑的地方——先查
`memory/claude-code-skill-tool-name-not-load-skill.md` 和
`memory/codex-no-native-skill-tool.md`,不要重新反推。更一般地:动手前先搜 memory 里有没有
同名/同主题的既有条目(`INDEX.md` 按分区索引),尤其是"这个协议字段长什么样"这类容易凭直觉
猜错、但本仓库可能已经拿真实 transcript 测过的问题。
