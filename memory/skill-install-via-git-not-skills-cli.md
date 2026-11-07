# repo skill 安装改走 git clone，不用 `npx skills add`

**设计裁决**(2026-07-12,实现结构化 `SkillSpec` 时)。

**曾选方案**:沿用旧实现的 `npx skills add <org/repo> -y -a <agent>`。

**否决理由**:定稿契约要求两件 `skills` CLI 给不了的事——
① **钉 ref**(tag / commit / branch):CLI 没有任何传 ref 的入口;
② **多 skill 仓库里显式选一部分,选不中要报出可选集**:CLI 的 `-l` 只吐带 ANSI 的人看清单,没有机器可读输出,枚举不了「这个 repo 里有哪些 skill」。

**现方案**:`src/agents/skills.ts` 直接走 git —— clone(给了 `ref` 就全量 clone 再 `checkout <ref>`)→ `find SKILL.md` 枚举 → 按 `skills?` 选择规则挑 → `cp -R` 进各 agent 的 skill 目录(claude-code `.claude/skills/<name>`,codex / bub `.agents/skills/<name>`,与旧实现落点一致)。
**顺带收益**:整类绕开了 [[npx-skills-add-headless-hang]]——不再依赖那个默认交互式的 CLI。

**已真机验证**(2026-07-13,`plan/docs-code-alignment-closeout.md` 收口时,真实 Docker + 真实 Anthropic/Codex API):repo skill(Claude Code、Codex 各自)、local skill(Claude Code,含改字节验证 sha256 变化)、native plugin(Claude Code、Codex 各自,用 `duyet/codex-claude-plugins`)全部跑通,`agent-setup.json` manifest 内容与磁盘产物用 `e2e/scripts/verify-agent-setup.mts` 深等验证。当时列的两条风险,结论:

1. **`claude plugin install` 在无 tty 沙箱里可能弹信任/确认提示**——**未复现**。真机多次运行(含网络瞬断重试)均在超时窗口内正常 exit,没有 headless 卡死。可以认为这条风险已排除,不是与 [[npx-skills-add-headless-hang]] 同类的问题。
2. **`codex plugin list --json` 的输出形状是猜的**——**确认是真 bug,已修**。真实形状是 `{ installed: [...] }` + `pluginId` 字段,不是猜测的裸数组或 `{ plugins: [...] }` + `id`;`resolvedVersion` 对任何真实安装都被静默省略。修在 `src/agents/codex.ts`,回归测试见 `src/agents/codex.test.ts`,详见 [[codex-plugin-list-json-shape-guessed-wrong]]。

真机验证过程中新发现两个未在原裁决预期内的问题:

3. **`marketplace.name` 不是调用方能自定的**:`ClaudeCodePluginSpec`/`CodexPluginSpec` 的文档与类型注释暗示这是调用方自选的连接名,但两家真实 CLI 都按目标仓库自己 manifest 里的 `name` 注册,与调用方传的字符串无关——传错名字时 `marketplace add` 会静默成功,下一步 `plugin install/add` 才报"找不到"。真实仓库复现,尚未修复(设计决定,不是可以顺手改的实现 bug)。详见 [[native-plugin-marketplace-name-not-caller-assignable]]。
4. **已修：Claude Code repo Skill 的真机行为断言查错了事件层**。最初把 `feature-skill-used` 的失败误诊为 `deepseek-v4-flash` 不触发原生 Skill；重新检查完整 artifact 后，旧 `events.json` 本来就有 `{"type":"skill.loaded","skill":"effect-ts"}`。真正问题是 parser 已按契约把原生 `Skill` tool_use 归一成一等 `skill.loaded`、且刻意不重复产出 `action.called`，E2E 却仍调用 `calledTool("Skill")`，所以必然查不到。修在 `e2e/shared/evals.ts`：正调改为 `t.loadedSkill(skill)`，反调断言不存在 `skill.loaded`。相同默认模型、真实 Docker + agent turn 复验 snapshot `.niceeval/features/2026-07-13T05-10-20-187Z-e3l7`，2/2 passed；无需切模型或新增凭据。

关联:[[npx-skills-add-headless-hang]]、[[codex-no-native-skill-tool]]、
[[claude-code-skill-tool-name-not-load-skill]](断言侧怎么验 skill 真的被用了)、
[[codex-plugin-list-json-shape-guessed-wrong]]、[[native-plugin-marketplace-name-not-caller-assignable]]。
