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
为 Bub 提供钉死版本的等价配方（PyPI 上的 Bub release + 同代 OTel 插件 commit），并写安装规格
指纹供 Adapter 校验。

NiceEval 已发布三份公共模板。消费方从 `niceeval/sandbox/e2b-template` 取具名常量
（`NICEEVAL_CODEX_E2B_TEMPLATE` 等），不手抄 namespace 或版本：

| Agent | 公共模板 | 版本位取自 |
|---|---|---|
| Claude Code | `correctroads-default-team/niceeval-claude-code` | `DEFAULT_CLAUDE_CODE_CLI_VERSION` |
| Codex | `correctroads-default-team/niceeval-codex` | `DEFAULT_CODEX_CLI_VERSION` |
| Bub | `correctroads-default-team/niceeval-bub` | `DEFAULT_BUB_VERSION` + 安装指纹 |

版本方案见[预制环境 · 版本号跟着被装的 Agent 走](../docs/feature/sandbox/library/prebuilt-environments.md#版本号跟着被装的-agent-走)：
tag 是 `<Agent 版本>-r<配方修订>`，三个 Agent 各自独立发版，niceeval 自身的版本不参与命名。

模板的发布门槛包含统一的运行用户 Node 工具契约：npm global prefix 为
`/usr/local`，对应 bin 与 module 目录可写，`/usr/local/bin` 在 PATH 中。配方由
`e2bCodingAgentTemplate()` 横切三条 baseline 保证，构建脚本以运行用户在 build 内自检；
自检不过的模板不会写入 registry。

台账 [`e2b/published.json`](./e2b/published.json) 记已发布事实：tag、Agent 版本、Template ID、
Build ID。`src/sandbox/e2b-agent-template.ts` 的 `PUBLISHED_E2B_BASELINE_TAG` 是它在源码里的镜像，
两者与版本常量的一致性由 `src/sandbox/official-baselines.test.ts` 守护——版本常量走在发布前面时测试红，
导出的常量不会先指向不存在的制品。

台账当前记录的三份制品发布于 Node 工具契约规范化之前：其中 Claude Code 基线的默认 npm prefix 仍是
只读的 `/usr`。下一组模板发布前，在这三份制品上运行时安装全局工具要用
`npm install -g --prefix /usr/local <pkg>`；不要改用 sudo，模板内既存的 root 全局包可能产生冲突。
剩余的验证与发布次序见 [`plan/e2b-template-runtime-contract.md`](../plan/e2b-template-runtime-contract.md)。

用户可以从公共 NiceEval 模板继续叠加自己的依赖，不必重走 Agent 安装：

```ts
const template = Template()
  .fromTemplate(NICEEVAL_CODEX_E2B_TEMPLATE)
  .aptInstall(["jq", "ripgrep"])
  .runCmd("corepack enable");
```

维护者重新构建时先登录 E2B。构建脚本自己按版本常量算 tag，并拒绝重建一个台账里已发布的 tag：

```bash
e2b auth login
pnpm tsx sandbox/e2b/build-agent-template.mts claude-code
pnpm tsx sandbox/e2b/build-agent-template.mts codex
pnpm tsx sandbox/e2b/build-agent-template.mts bub
```

只重建换了配方的那个 Agent；另外两份制品的引用不动。构建脚本第二个参数可以传自定义 alias，
用来在不动公共模板的前提下试构建。

维护者和用户都可以编辑 [`e2b/build-agent-template.mts`](./e2b/build-agent-template.mts)，在
`Template.build()` 前继续链 E2B 原生 `.aptInstall()`、`.runCmd()` 或 `.copy()`。这保留了
“基于官方模板继续改”的能力，不把 provider 的构建 API 包进 NiceEval 私有 DSL。

构建会同时写 `default`（不带 tag 的名字跟随它，只适合交互试用）和 `<Agent 版本>-r<配方修订>`
版本 tag。公开模板要额外执行 `e2b template publish <name> --yes`；跨 Team 引用必须保留
`correctroads-default-team/` namespace。模板要通过构建脚本里的 npm prefix / PATH / 写权限自检
后才能发布；发布完成并真机验证后，同一批改动更新 `e2b/published.json` 与
`src/sandbox/e2b-agent-template.ts` 的 `PUBLISHED_E2B_BASELINE_TAG`，不能让常量提前指向不存在的制品。

## Docker：NiceEval 的 Agent 基线镜像

[`docker/Dockerfile`](./docker/Dockerfile) 为每个内置 coding Agent 定义独立 target。
Bub / Hermes 与运行时 Adapter 使用相同的 `$HOME/.local` 布局；Bub 另写安装规格指纹。
各 Agent 的版本都固定，升级后应重建一个新 tag。

NiceEval 维护公开镜像：
[`niceeval/claude-code`](https://hub.docker.com/r/niceeval/claude-code)、
[`niceeval/codex`](https://hub.docker.com/r/niceeval/codex)、
[`niceeval/bub`](https://hub.docker.com/r/niceeval/bub)、
[`niceeval/opencode`](https://hub.docker.com/r/niceeval/opencode)、
[`niceeval/hermes`](https://hub.docker.com/r/niceeval/hermes)、
[`niceeval/openclaw`](https://hub.docker.com/r/niceeval/openclaw)。
每个镜像发布多架构 manifest（`linux/amd64`、`linux/arm64`），tag 为
`<Agent 版本>-r<配方修订>`；已有 E2B 模板的 Agent 与对应模板同号。
`latest` 跟随该 Agent 的最新基线，只适合交互试用；用户与 CI 固定版本 tag 或 digest，
并直接用 `niceeval/sandbox` 导出的常量：

```ts
import { NICEEVAL_CODEX_DOCKER_IMAGE, dockerSandbox } from "niceeval/sandbox";

sandbox: dockerSandbox({ image: NICEEVAL_CODEX_DOCKER_IMAGE })
```

镜像由 [Docker image workflow](../.github/workflows/docker-image.yml) 在基线配方变更落到 `main`
时构建并推送（`sandbox/docker/**` 与版本常量所在文件），也可手动派发；它按
`agentBaselineVersionTag()` 解析 tag。已发布的 tag 默认跳过（不原地覆盖）——重建要先 bump
配方修订号；同一次 push 里未变的 Agent 跳过，不影响新 Agent 的发布。因此 Docker 侧的具名常量由版本常量直接派生，不像 E2B 侧那样另存一份发布台账。
发布前在 GitHub 仓库设置里创建 `DOCKERHUB_TOKEN` secret：它是 Docker Hub 用户 `niceeval`
的专用 PAT，权限至少为 Read & Write；不要使用登录密码或把 token 写进仓库。Docker Hub repository
必须设为 Public，才能让外部 eval 项目拉取。

```bash
docker build --target codex -t niceeval/codex:local sandbox/docker
docker build --target opencode -t niceeval/opencode:local sandbox/docker
```

要加项目依赖，写一个从该 image `FROM` 的项目 Dockerfile；不必 fork Adapter。派生镜像的 tag
同样把版本位留给它装的东西，别写自己仓库的版本号。

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
[`src/agents/bub-install-spec.ts`](../src/agents/bub-install-spec.ts)（版本位本身在
[`src/agents/coding-cli-versions.ts`](../src/agents/coding-cli-versions.ts)）。E2B 和 Vercel 构建
代码直接复用它；Dockerfile 不能导入 TypeScript，修改该文件后必须同步
[`docker/bub-override.txt`](./docker/bub-override.txt)、Dockerfile 的插件 URL 和 marker hash，
再重建制品。`src/sandbox/official-baselines.test.ts` 守护这些值不漂移。

那份 override 文件不是遗留物：OTel 插件所在的 workspace 把 `bub` 声明成 git 依赖，不覆盖的话
每次安装都会去拉 Bub 主干，制品里的版本随构建时间漂移。所以三条构建路径与运行时安装都先写一份
把 `bub` 钉成 `bub==<version>` 的 override 再装。

换 Bub 版本时必须同批核对插件 pin：Bub 0.3.10 起 vendor 了 `bub.tape`，之后的插件从那里取类型，
配 0.3.9 会 import 失败；反过来旧插件按 republic 的类型校验，配新 Bub 是 span 全被拒、时间轨
静默为空。两代成对钉的契约与用户侧旋钮见
[Bub 契约页](../docs/feature/adapters/sdk/bub/README.md#装哪一版-bub)。
