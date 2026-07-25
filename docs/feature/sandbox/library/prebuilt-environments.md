# 预制环境 —— 把稳定依赖做成可发布产物

稳定、体积大、每个 attempt 都相同的内容不该在运行时安装:系统包、agent CLI、编译好的二进制、数百 MB 的模型 cache、固定语言工具链。这些应在跑 eval 之前做进 provider 的**可发布环境产物**,attempt 从产物起实例、跳过安装直接开跑。

分工一句话:**构建归 provider 原生工具,NiceEval 只消费产物 ID。**

| provider | 构建产物 | experiment 消费 | 共享边界 | 过期 |
|---|---|---|---|---|
| Docker | OCI image | `dockerSandbox({ image })` | 本地或任意 registry | 自管 |
| E2B | template | `e2bSandbox({ template })` | team 私有,可公开发布 | 随 E2B 模板生命周期 |
| Vercel Sandbox | sandbox snapshot | `vercelSandbox({ snapshotId })` | 仅 Team/Project 内 | Run 有效期由 Vercel 定 |

## 按 environment 选预制产物

一个实验里的 eval 不必共享同一个预制产物。eval 用 [`environment`](../../eval/README.md) 声明 provider-neutral 的需求 profile；spec 工厂的 `environments` 表把 profile 翻译成本 provider 的产物——值就是上表「experiment 消费」字段的覆盖：

```typescript
// experiments/shared.ts —— 一个 provider 一张表，多个实验共用这个 spec
export const e2b = e2bSandbox({
  template: "niceeval-agents",                  // 未声明 environment 的 eval 从它起步
  environments: {
    "python-3.9-astropy-4.2": { template: "niceeval-py39-astropy42" },
  },
});
```

- 表是纯数据：键为 profile id，值的字段由各内置工厂类型声明（docker `{ image }`、e2b `{ template }`、vercel `{ snapshotId }`），写错字段名由类型检查拦下。`defineSandbox` 自定义 spec 没有 `environments` 表——自定义 provider 没有 NiceEval 认识的产物槽位；声明了 `environment` 的 eval 搭配自定义 spec 同样按缺表项报启动期配置错误。
- 解析发生在调度前：选中 eval 声明的 profile 缺表项是启动期配置错误，一次穷举列出全部 (eval id, profile) 缺项，不创建任何沙箱、不消耗预算。
- 查表只替换这条 eval 的起点产物；`.setup()` / `.teardown()` 钩子链与其余 spec 参数对全部 eval 共享。
- 逐 eval 的解析结果经 `publicConfig()` 投影落 Run 的 `sandboxByEval`，见 [Results · run.json](../../record/architecture.md#runjson)。

## 为什么没有跨 provider 构建 DSL

三者的构建上下文、凭据、发布、过期和销毁语义不同。把它们压成一个 `snapshot("name")` 会隐藏真实的运维边界;项目应保留 provider 原生的构建脚本,把产物 ID / 名字写进 typed sandbox spec。`sandbox.setup` 只处理必须按 experiment / attempt 变化的小配置、状态恢复和 fail-fast 预检(分层判据见 [环境预置放哪](../library.md#环境预置放哪))。

## 用户怎么写自己的预制环境

构建语法各异,工作流骨架跨 provider 相同:

1. **构建脚本进 eval 项目仓库**,约定放 `scripts/build-<provider>-env.*`;experiment 里永远只出现产物 ID,不出现构建逻辑。
2. **产物命名带版本,版本位写产物里装的东西**:`<项目>-<agent>-evals:<agent 版本>-r<配方修订>`(如 `acme-codex-evals:0.144.1-r1`)。消费者关心的是"这份环境里的 Agent 是哪一版",不是构建脚本所在仓库发到第几版;`-r` 位留给"Agent 版本没变、配方变了"的重建([官方基线用的是同一套规则](#版本号跟着被装的-agent-走))。CI 与需要可复现结果的场景钉死 tag;不带 tag 的名字跟随最新构建,只适合本地试用。
3. **重建只在环境依赖变化时发生**:改了要装的 CLI 版本、系统包或模型 cache 才跑构建脚本;日常 `niceeval exp` 直接消费既有产物。
4. **升级 agent CLI 版本 = 构建一个新 tag**,experiment 改引用即可、回滚可逆;不要原地覆盖同一个 tag——那会让"同一配置"在不同时间指向不同环境,跑分失去可比性。

进不进预制产物的判据只有一条:**这内容是不是所有 attempt 都相同、且与本次实验的参数无关。** 按实验变化的内容(装不装某二进制、开不开预热)进 [`.setup()` 钩子](../library.md#沙箱生命周期钩子setup-teardown);按 eval 变化的任务 Fixture 进 `test(t)`。

### Docker:Dockerfile 派生

官方基线就是默认镜像 `node:24-slim`(省略 `image` 时按 runtime 选它)。写 Dockerfile 从它派生、把 Agent CLI 烘焙进去。`npm install -g` 装进 `/usr/local/bin`,正好落在沙箱注入的 PATH 上;沙箱默认以非 root 的 `node`(UID 1000)用户跑命令,装到别处(如 `~/.local/bin`)的 Agent 需自己进 PATH:

```dockerfile
# Dockerfile
FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.144.1
```

```typescript
// docker build -t acme-codex-evals:0.144.1-r1 . 之后
sandbox: dockerSandbox({ image: "acme-codex-evals:0.144.1-r1" })
```

镜像只在构建机上时是单机可用;要在 CI 或多机消费,push 到项目自己的 registry,`image` 字段写完整引用。

### E2B:TemplateBuilder 派生

`niceeval/sandbox/e2b-template` 提供一个很薄的 **E2B 专属** factory `e2bCodingAgentTemplate(agent)`,从官方 coding agent 起点派生并返回原生 `TemplateBuilder`。用户可以继续链 E2B API,所以"官方基线"不会成为不能修改的黑盒:

Factory 同时收敛三条基线的 Node 工具安装面：运行用户的 `npm prefix -g` 是 `/usr/local`，`/usr/local/bin` 已在 PATH，`/usr/local/bin` 与 `/usr/local/lib/node_modules` 对运行用户可写。E2B 官方 `claude` 与 `codex` 起点的 Node 路径和默认 prefix 不同，这层规范化是 NiceEval 派生 baseline 的职责；否则同一条 eval 的 `npm install -g` 会只因换 Agent 而成片失败。因此项目追加全局 Node 工具用普通 `npm install -g <pkg>`，不需要按 Agent 分支，也不需要 sudo。`verifyE2BNodeToolContract(template)` 把这三条断言链进 build，任一项漂移时模板在写入 registry 前构建失败——这也是[官方公共基线](#官方-coding-agent-起点)的发布门槛。

```typescript
// scripts/build-e2b-template.ts
import { Template } from "e2b";
import { e2bCodingAgentTemplate } from "niceeval/sandbox/e2b-template";

const template = e2bCodingAgentTemplate("codex") // 从 E2B 官方 codex template 派生
  .aptInstall(["ripgrep", "jq"])
  .runCmd("corepack enable && pnpm --version")
  .copy("fixtures/toolchain.lock", "/opt/evals/toolchain.lock");

await Template.build(template, "acme-codex-evals:0.144.1-r1", {
  cpuCount: 2,
  memoryMB: 4096,
});
```

```bash
pnpm tsx scripts/build-e2b-template.ts
```

构建只在环境依赖变化时运行;日常 `niceeval exp` 直接消费项目自己的 alias:

```typescript
sandbox: e2bSandbox({ template: "acme-codex-evals:0.144.1-r1" })
```

Bub 若配置 `pythonPlugins`,模板 factory 要收到同一份 package 集合:`e2bCodingAgentTemplate("bub", { bubPythonPackages: ["bub-plugin-memory==1.3.0"] })`。Factory 与 Adapter 共用规范化和 hash 代码,插件顺序、空白和重复项不会制造假差异;集合真的不同则不会误用预装环境(指纹语义见 [Bub 接入页](../../adapters/sdk/bub/README.md))。

### Vercel Sandbox:从运行实例拍 Run

Vercel 没有 template registry,也没有 Dockerfile;Run 从一台跑起来的 microVM 拍出来。用 Vercel SDK 从官方 runtime(`node24`)起沙箱、装 Agent CLI、调 `.snapshot()` 拿到 `snap_...`,experiment 再引用这个 ID:

```typescript
// scripts/build-vercel-snapshot.ts
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create({ runtime: "node24" });
await sandbox.runCommand({ cmd: "npm", args: ["install", "-g", "@openai/codex@0.144.1"], sudo: true });
const { snapshotId } = await sandbox.snapshot(); // snap_...
await sandbox.stop();
```

Vercel snapshot 只有 Team/Project 共享,没有 E2B `template publish` 对应的公共发布语义。NiceEval 仓库可记录维护者项目的 snapshot ID 供该项目复用,公共用户仍需在自己的 Vercel Project 运行构建脚本。文档和 API 必须把这个权限差异说出来,不能把"拿到 ID"写成"任何账号可启动"。

## 官方 coding agent 起点

"没有跨 provider 构建 DSL"不等于每个项目都要从空白环境安装 coding agent。NiceEval 为内置
coding Agent 维护公共基线制品：Docker image 六家齐全；E2B template 覆盖
Claude Code / Codex / Bub（其余 Agent 的 E2B 模板未进台账，不导出常量）；
配方同源、版本号共用：

| Agent | E2B 公共模板 | Docker 公共镜像 | 起点与校验 |
|---|---|---|---|
| [Claude Code](../../adapters/sdk/claude-code/README.md) | `correctroads-default-team/niceeval-claude-code` | `niceeval/claude-code` | E2B 侧从 provider 官方 `claude` template 派生;Claude Adapter 仍检查 `claude` |
| [Codex](../../adapters/sdk/codex-cli/README.md) | `correctroads-default-team/niceeval-codex` | `niceeval/codex` | E2B 侧从 provider 官方 `codex` template 派生;Codex Adapter 仍检查 `codex` |
| [Bub](../../adapters/sdk/bub/README.md) | `correctroads-default-team/niceeval-bub` | `niceeval/bub` | 两侧都用 NiceEval 钉版本的配方(Bub 版本 + 同代 OTel 插件),并写安装规格 marker;Bub Adapter 只信任指纹完全匹配的预装环境 |
| [OpenCode](../../adapters/sdk/opencode/README.md) | — | `niceeval/opencode` | Docker 烘焙 `opencode-ai`;Adapter 检测 PATH 上的 `opencode` |
| [Hermes](../../adapters/sdk/hermes/README.md) | — | `niceeval/hermes` | Docker 按 `$HOME/.local` 装 `hermes-agent`;Adapter 走同路径 |
| [OpenClaw](../../adapters/sdk/openclaw/README.md) | — | `niceeval/openclaw` | Docker 烘焙 `openclaw`;Adapter 检测 PATH 上的 `openclaw` |

Vercel 没有可公开发布的产物原语,官方基线止步于 E2B 与 Docker;Vercel 用户按上面的[Run 构建流程](#vercel-sandbox从运行实例拍 Run)在自己的 Project 里构建。

### 版本号跟着被装的 Agent 走

公共基线的版本形如 `<Agent 版本>-r<配方修订>`,例如 `niceeval/codex:0.144.1-r1`:

- **版本位是制品里那个 Agent 的版本**——Claude Code 与 Codex 取 CLI 版本,Bub 取所钉 commit 承接的 bub release。消费者唯一关心的就是这个:这份环境里的被测对象是哪一版。
- **`-r` 修订位是 NiceEval 配方自己的修订号**。Agent 版本没变、基线配方变了(Node 工具契约、PATH 规范化、换 pin 的 commit、插件集合)就 +1;Agent 版本一变归 1。已发布 tag [不可原地覆盖](#用户怎么写自己的预制环境),配方变更必须在版本里有位置表达,否则"同一配置"会在不同时间指向不同环境。
- **各 Agent 各自独立发版**。换 Codex CLI 只重建 codex 的制品,其它 Agent 的引用一个字不动。
  同一 Agent 若某一侧(E2B / Docker)尚未发布,只重建已有侧,不伪造另一侧的引用。
- **niceeval 自身的版本不参与命名**。库与制品内容无关:发一个 patch 不会让模板里的 Agent 变新,模板换代也不必等库发版。
- **同一个 Agent 在已发布的 provider 上共用一个版本号**:一个版本号 = 一套基线配方。任一侧的配方变更 bump `-r`,并重建该侧已有制品。

版本位与 Adapter 运行时回退安装读的是同一批版本常量,所以"命中预装"和"回退安装"永远装同一版 Agent——走了哪条路径不会改变被测对象。

### 消费:具名常量,不拼版本号

版本按 Agent 各自演进,业务仓库不该跟踪三条版本线。两个 provider 的完整引用都由 NiceEval 导出:

```typescript
import {
  NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  NICEEVAL_CODEX_E2B_TEMPLATE,
  NICEEVAL_BUB_E2B_TEMPLATE,
} from "niceeval/sandbox/e2b-template";
import {
  NICEEVAL_CLAUDE_CODE_DOCKER_IMAGE,
  NICEEVAL_CODEX_DOCKER_IMAGE,
  NICEEVAL_BUB_DOCKER_IMAGE,
  NICEEVAL_OPENCODE_DOCKER_IMAGE,
  NICEEVAL_HERMES_DOCKER_IMAGE,
  NICEEVAL_OPENCLAW_DOCKER_IMAGE,
} from "niceeval/sandbox";

e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })      // 跨 Team namespace + 钉死版本
dockerSandbox({ image: NICEEVAL_CODEX_DOCKER_IMAGE })      // repository + 同一个版本
dockerSandbox({ image: NICEEVAL_OPENCODE_DOCKER_IMAGE })
```

每个常量都是完整、版本钉死的引用,值只在 NiceEval 发布新基线时变化。下游不复制这些字符串,也不维护第二份版本常量;派生制品要把 base 身份写进名字或 provenance 时,直接用常量的值。公开基线是 convenience baseline,不是 Adapter 的隐式默认值。

常量指向的一定是**已发布并验证过的**制品:E2B 侧由维护者发布后登记进[发布台账](../../../../sandbox/README.md),Docker 侧由配方变更触发的 CI 发布;两侧都以构建内自检为发布门槛(Node 工具契约见[上文](#e2btemplatebuilder-派生)),自检不过的制品不写进 registry。

Adapter 不自动替 experiment 选择制品:同一个 Codex Adapter 可以跑 Docker、E2B 或 Vercel,选择权属于 sandbox spec;反过来,sandbox 也不猜要运行哪个 Agent。预装只是快速路径,各 agent 检测预装与回退安装的具体语义在各自的接入页(上表链接)。

## 新 provider 的预制环境义务

[接一个新 provider](../architecture.md#再接一个-provider)时,预制环境的故事随接口一起交付:

- **spec 上有一个消费字段**,语义是"从这个产物起实例"——对应 Docker 的 `image`、E2B 的 `template`、Vercel 的 `snapshotId`。字段名用该服务的原生词汇,不翻译成统一术语。这个字段同时就是 [`environments` 表](#按-environment-选预制产物)的值类型:按 profile 覆盖的正是它。
- **构建留在服务原生工具**:不为新 provider 发明 niceeval 构建命令,也不包一层构建 API;项目保留原生构建脚本,spec 只引用产物。
- **共享与过期语义如实文档化**:产物是账号私有还是可公开、会不会过期、跨 team 引用要什么 namespace,写进该 provider 的接入文档,不许诺服务给不了的可见性。
- **服务没有可发布产物原语时不伪造**:spec 不加假字段;该 provider 的用户用 [`.setup()` 钩子](../library.md#沙箱生命周期钩子setup-teardown)做运行时安装,或用下面的运行时 checkpoint 缓存安装结果。

## 运行时 checkpoint:`createCheckpoint` / `restoreCheckpoint`

`niceeval/sandbox` 另有 provider 无关的 `createCheckpoint` / `restoreCheckpoint`:把指定的 Linux 文件路径打成 tar `Buffer`,之后恢复进另一个已创建的 Sandbox。它适合在运行时缓存安装结果,或在同一套 harness 中搬运文件系统片段;不是云端可发布模板,也不会替你管理版本、过期或共享:

```typescript
import { createCheckpoint, restoreCheckpoint } from "niceeval/sandbox";

const checkpoint = await createCheckpoint(sandbox, ["/home/user/.cache/my-tool"]);
await restoreCheckpoint(nextSandbox, checkpoint);
```

归档、上传、下载或解压失败都会抛错;调用者决定把 `Buffer` 存到内存、磁盘还是外部对象存储。

## 相关阅读

- [Library](../library.md) —— spec 工厂、生命周期钩子、环境预置分层。
- [Architecture · 性能](../architecture.md#性能预制环境复用与预热) —— 预制环境在性能优先级里的位置。
- [Architecture · 再接一个 provider](../architecture.md#再接一个-provider) —— provider 接口与接入路径。
