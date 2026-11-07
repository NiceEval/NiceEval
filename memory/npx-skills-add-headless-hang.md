# `npx skills add` 默认交互式,headless 沙箱里会卡死

**现象**：`src/agents/claude-code.ts` / `src/agents/codex.ts` 的 `skills` 配置项在沙箱 `setup()`
阶段跑 `npx skills add <org/repo>`(不带任何 flag)。在 Docker 沙箱(无 tty)里手动复现:命令
clone 完 repo、列出 skill 后卡在一个"Which agents do you want to install to?"的交互式多选框,
永远等不到 stdin,直到 attempt 超时。

**根因**：`skills`(vercel-labs/skills)CLI 的 `add` 子命令默认会弹交互确认 + agent 选择器;
只有部分 agent(Amp / Codex / Cursor / Gemini CLI 等)在其"Universal"目录下默认勾选,
Claude Code 不在默认勾选列表里,必须显式选。`-y`(跳过确认)和 `-a <agent>`(显式指定目标)
两个 flag 加起来才能让整个流程完全非交互。

**修法**：`src/agents/claude-code.ts` 的 setup 改成
`npx skills add <source> -y -a claude-code`;`src/agents/codex.ts` 改成
`npx skills add <source> -y -a codex`。验证方式:在 Docker 容器里以非 root 用户(HOME=/home/node,
和 `DockerSandbox` 的真实执行身份一致)分别跑 `npx skills add Effect-TS/skills`(不带 flag,
15s 超时后仍卡在选择框)和加 flag 后的版本(几秒内 exit 0),确认前者会挂、后者不会。

安装落点也一并确认(供 skill 断言用):`-a claude-code` 落在 `.claude/skills/<name>`(project 级);
`-a codex` 落在 `.agents/skills/<name>`(skills 包的"通用"目录,codex 在默认勾选列表里但装的仍是
这个通用路径,不是 `.codex/`)。两者都会在 `<workdir>/skills-lock.json` 记一条 `skills.<name>.source`。

适用场景:任何在无 tty 环境(CI、沙箱容器)里跑 `skills` CLI 的地方,不只是 niceeval 的 adapter。

已修复：`src/agents/claude-code.ts` / `src/agents/codex.ts`(2026-07-09,e2e 沙箱矩阵落地时发现)。
