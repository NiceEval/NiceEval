# 预制 coding-agent 环境

这个目录保存 NiceEval 自己维护的可复现构建配方。预制环境是性能建议，不是运行前提：
Adapter 仍会检查 CLI，缺少时执行运行时安装。

职责分成两层：

- Sandbox/provider 决定环境制品是什么、怎样构建、发布、过期和启动。
- Agent Adapter 声明自己需要什么 CLI，并在 `setup` 时验证或安装。它不替用户选择 provider。

因此不存在跨 provider 的 `snapshot("name")` 构建命令。Docker image、E2B template 和
Vercel snapshot 保留各自的原生生命周期；Experiment 统一用 typed sandbox spec 消费它们。

## E2B：基于官方 Agent 模板继续派生

E2B 已提供 Claude Code 的 `claude` template 和 Codex 的 `codex` template。NiceEval 的
`e2bCodingAgentTemplate()` 直接从这两个官方起点派生。E2B 暂无 Bub 官方 template，NiceEval
为 Bub 提供固定到不可变 Git commit 的等价配方，并写安装规格指纹供 Adapter 校验。

NiceEval 已发布三份公共模板。CI 应固定 release tag；交互试用可省略 tag，跟随当前稳定版：

| Agent | 公共模板 | `v0.6.1` 验证内容 |
|---|---|---|
| Claude Code | `correctroads-default-team/niceeval-claude-code` | `claude 2.1.207` |
| Codex | `correctroads-default-team/niceeval-codex` | `codex 0.144.1` |
| Bub | `correctroads-default-team/niceeval-bub` | marker `83770925b77a` |

```ts
sandbox: e2bSandbox({
  template: "correctroads-default-team/niceeval-codex:v0.6.1",
})
```

用户可以从公共 NiceEval 模板继续叠加自己的依赖，不必重走 Agent 安装：

```ts
const template = Template()
  .fromTemplate("correctroads-default-team/niceeval-codex:v0.6.1")
  .aptInstall(["jq", "ripgrep"])
  .runCmd("corepack enable");
```

发布记录、Template ID、Build ID 和验证版本见 [`e2b/published.json`](./e2b/published.json)。
维护者重新构建时先登录 E2B：

```bash
e2b auth login
pnpm tsx sandbox/e2b/build-agent-template.mts claude-code acme-claude-evals
pnpm tsx sandbox/e2b/build-agent-template.mts codex acme-codex-evals
pnpm tsx sandbox/e2b/build-agent-template.mts bub acme-bub-evals
```

维护者和用户都可以编辑 [`e2b/build-agent-template.mts`](./e2b/build-agent-template.mts)，在
`Template.build()` 前继续链 E2B 原生 `.aptInstall()`、`.runCmd()` 或 `.copy()`。这保留了
“基于官方模板继续改”的能力，不把 provider 的构建 API 包进 NiceEval 私有 DSL。

构建会同时写 `default`、`stable` 和当前 Git release tag。公开模板要额外执行
`e2b template publish <name> --yes`；跨 Team 引用必须保留 `correctroads-default-team/` namespace。

## Docker：NiceEval 的三 Agent 基线镜像

[`docker/Dockerfile`](./docker/Dockerfile) 预装 Codex、Claude Code 和 Bub。Bub 与运行时
Adapter 使用相同的 `$HOME/.local` 布局和安装规格指纹；三个 Agent 的版本都固定，升级后
应重建一个新 tag。

```bash
docker build -t acme/niceeval-agents:2026-07-13 sandbox/docker
```

用不可变 tag 或 digest 运行 CI，不要依赖会移动的 `latest`：

```ts
sandbox: dockerSandbox({ image: "acme/niceeval-agents:2026-07-13" })
```

要加项目依赖，写一个从该 image `FROM` 的项目 Dockerfile；不必 fork Adapter。

## Vercel：从已配置的 microVM 拍 snapshot

Vercel 的制品是运行中 Sandbox 的 snapshot。脚本安装三个 Agent、完成自检后调用
`snapshot()`，并打印要写进 Experiment 的 ID：

```bash
# VERCEL_API_TOKEN + VERCEL_TEAM_ID [+ VERCEL_PROJECT_ID]
node --import tsx sandbox/vercel/build-vercel-snapshot.mts
# => snapshotId: snap_xxx
```

```ts
sandbox: vercelSandbox({ snapshotId: "snap_xxx" })
```

NiceEval 项目当前验证过的永不过期 snapshot 是
`snap_7sIjfs71xfmVly0WEUTGhTBoMGeL`，项目成员可以直接引用；完整记录见
[`vercel/published-snapshot.json`](./vercel/published-snapshot.json)。Vercel snapshot 受 Team/Project
权限控制，没有类似 E2B `template publish` 的公共发布机制，不能把这个 ID 宣称为跨账号公共模板。

若需继续定制，在拍 snapshot 前向脚本增加命令。Snapshot 有 provider 自己的过期策略；
CI 应把 ID 当成部署产物管理，并定期重建，而不是在每个 Attempt 内重新安装。

## Bub 一致性约定

Bub 的默认版本、OTel 插件和安装指纹的唯一代码源是
[`src/agents/bub-install-spec.ts`](../src/agents/bub-install-spec.ts)。E2B 和 Vercel 构建代码
直接复用它；Dockerfile 不能导入 TypeScript，修改该文件后必须同步
[`docker/bub-override.txt`](./docker/bub-override.txt)、Dockerfile 的插件 URL和 marker hash，
再重建制品。测试会守护这些值不漂移。
