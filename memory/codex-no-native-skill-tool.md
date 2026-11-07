# codex 没有原生 Skill 工具,不提示就几乎不会主动去读装好的 skill

**现象**：给 `codexAgent` 用 `skills: ["Effect-TS/skills"]` 装好 skill 后(实测落在
`.agents/skills/effect-ts/`,`skills-lock.json` 也确实写了),直接问一个会触发该 skill 的问题,
`codex exec --json` 的事件流里没有任何工具调用去读 skill 文件,回答纯靠模型自带知识——
和 claude-code 的 `Skill` 工具那种"自动判断要不要用"完全不是一回事。

**根因**：`skills`(vercel-labs/skills)CLI 只负责把 skill 文件"物理装到"每个 agent 的约定目录
(claude-code 是 `.claude/skills`,codex 走的是"通用" `.agents/skills`),但 codex CLI 本身不像
claude-code 那样有一个内置的、会主动扫描并加载 skill 的机制——它不知道 `.agents/skills` 这个
目录的存在,除非 prompt 或 AGENTS.md 明说。

实测(Docker 沙箱,`codex exec --json --dangerously-bypass-approvals-and-sandbox`):
1. 提示词只问业务问题,不提 skill/guide → 零 shell 调用,直接凭内置知识回答。
2. 提示词加一句"Check whether this repo has a skill or guide file about it before answering"→
   codex 自己跑 `rg --files -g 'SKILL.md' ...`、`cat .agents/skills/effect-ts/SKILL.md`,
   读完再作答,回复里能看到 skill 文件的具体内容(如 vendored 依赖路径的细节)。

**修法**(使用侧结论):codex 的 skill 断言不能等价照抄 claude-code 那套"看有没有调用某个工具"——
(a) prompt 必须显式提示"检查有没有 skill/guide 文件"(不提示则该行为几乎不会触发,不是
"较低概率触发"这种统计噪音,是机制上就没有钩子);(b) 断言从"是否执行过读取该 skill 路径的
shell 命令"这个行为痕迹认,不是从某个专属工具名认——落点见
`e2e/shared/evals.ts` 的 `skillUsed(p)` / `skillAbsent(p)`(`profile.skillDetection === "shell"`
分支,正则匹配 `command` 入参里的 `<skillInstallDir>/<skill>`)。

适用场景:任何要在 codex 上验证"skill 有没有被用到"的地方;claude-code 那边的对应结论见
[[claude-code-skill-tool-name-not-load-skill]]。
