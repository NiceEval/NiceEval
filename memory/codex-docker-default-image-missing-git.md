---
name: codex-docker-default-image-missing-git
description: "dockerSandbox 默认镜像 node:24-slim 不带 git;codex plugin marketplace add owner/repo 与 SkillSpec{kind:\"repo\"} 都在容器内部靠系统 git clone 实现,默认镜像下 100% 失败"
metadata:
  type: infra-bug
---

**现象**:`e2e/repos/codex-cli` 的 native Plugin 实验(挂载一个真实公开 GitHub 仓库当
Marketplace)在默认 `dockerSandbox()`(镜像 `node:24-slim`)下,`agent.setup` 阶段必现:

```
Error: failed to run git clone https://github.com/<owner>/<repo>.git /root/.codex/.tmp/marketplaces/.staging/marketplace-add-XXXXXX: No such file or directory (os error 2)
```

本机 Docker 手动复现确认:`docker run --rm --platform linux/amd64 node:24-slim sh -c "which git"`
恒返回 `NO_GIT`——这个镜像本来就不装 git,不是环境特例。

**根因**:`codex plugin marketplace add <owner>/<repo>` 与 `codex plugin marketplace add
<git-url>` 在 Codex CLI 内部都是 shell 出去调系统 `git clone`(不是 vendor 的纯 Rust git 实现),
`os error 2`(ENOENT)就是找不到 `git` 可执行文件。`SkillSpec: { kind: "repo", source, ref }`
走的 `installSkills()` 同样是 `git clone --quiet ... && git -C ... checkout --quiet ...`
(`src/agents/skills.ts`),同一个前提缺失。`codexAgent` / `claudeCodeAgent` 的内置 `setup()`
只 `npm install -g` 各自的 CLI,从不装 git;`CodexConfig` 也没有能在 `installPlugins`/
`installSkills` **之前**插入一步"先装 git"的钩子(`postSetup` 排在这两者**之后**才跑)。

**修法**:在 Sandbox 层(而不是 Agent 层)插入这一步——`dockerSandbox().setup(fn)` 挂的
`sandbox.setup` 生命周期钩子跑在 `agent.setup`(codexAgent 的 `installPlugins`/
`installSkills`)**之前**(执行顺序:`沙箱就绪 → sandbox.setup → workspace 基线 → eval.setup →
agent.setup → ...`,见 `src/sandbox/types.ts` 的 `SandboxHooks` 文档注释),是目前唯一能在
这两个内置 Adapter 既有生命周期里"装 git 但不改 Adapter 本身"的位置:

```ts
sandbox: dockerSandbox().setup(async (sb) => {
  await sb.runShell("apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null");
}),
```

只覆盖**需要它的那个实验**的 `sandbox`(`ExperimentDef.sandbox` 可覆盖项目级配置),不要写进
项目级 `niceeval.config.ts`——`apt-get update` 实测约 70 秒,不需要 git 的实验(纯 MCP、
纯 configFile、baseline 等)不该为此买单。能不依赖 git 就不依赖:本仓库的 Skill 因此改用
`kind: "local"`(仓库自带 `SKILL.md`,不需要外部仓库也不需要 git),只有 native Plugin(必须
`owner/repo` 或 git URL 才能被 Codex 认作 Marketplace 来源,没有 tarball/HTTP 替代路径)才
真正需要这份 apt-get 开销。

**适用场景**:任何在 Docker Sandbox(默认 `node:*-slim` 镜像)里用 `codexAgent`/
`claudeCodeAgent` 的 `plugins` 字段挂载**远程仓库形态**的 native Marketplace,或用
`skills: [{ kind: "repo", ... }]` 装非本地 Skill 的场景——两者都隐式要求容器里有 `git`,
默认镜像不满足,必须在 `sandbox.setup()` 钩子里显式装。
