# 预制环境 —— 把稳定依赖做成可发布产物

稳定、体积大、每个 attempt 都相同的内容不该在运行时安装:系统包、agent CLI、编译好的二进制、数百 MB 的模型 cache、固定语言工具链。这些应在跑 eval 之前做进 provider 的**可发布环境产物**,attempt 从产物起实例、跳过安装直接开跑。

分工一句话:**构建归 provider 原生工具,NiceEval 只消费产物 ID。**

| provider | 构建产物 | experiment 消费 | 共享边界 | 过期 |
|---|---|---|---|---|
| Docker | OCI image | `dockerSandbox({ image })` | 本地或任意 registry | 自管 |
| E2B | template | `e2bSandbox({ template })` | team 私有,可公开发布 | 随 E2B 模板生命周期 |
| Vercel Sandbox | sandbox snapshot | `vercelSandbox({ snapshotId })` | 仅 Team/Project 内 | 快照有效期由 Vercel 定 |

## 为什么没有跨 provider 构建 DSL

三者的构建上下文、凭据、发布、过期和销毁语义不同。把它们压成一个 `snapshot("name")` 会隐藏真实的运维边界;项目应保留 provider 原生的构建脚本,把产物 ID / 名字写进 typed sandbox spec。`sandbox.setup` 只处理必须按 experiment / attempt 变化的小配置、状态恢复和 fail-fast 预检(分层判据见 [环境预置放哪](../library.md#环境预置放哪))。

## 用户怎么写自己的预制环境

构建语法各异,工作流骨架跨 provider 相同:

1. **构建脚本进 eval 项目仓库**,约定放 `scripts/build-<provider>-env.*`;experiment 里永远只出现产物 ID,不出现构建逻辑。
2. **产物命名带版本**:`<项目>-<agent>-evals:<日期或语义版本>`(如 `acme-codex-evals:2026-07-13`)。CI 与需要可复现结果的场景钉死 tag;不带 tag 的名字跟随最新构建,只适合本地试用。
3. **重建只在环境依赖变化时发生**:改了要装的 CLI 版本、系统包或模型 cache 才跑构建脚本;日常 `niceeval exp` 直接消费既有产物。
4. **升级 agent CLI 版本 = 构建一个新 tag**,experiment 改引用即可、回滚可逆;不要原地覆盖同一个 tag——那会让"同一配置"在不同时间指向不同环境,跑分失去可比性。

进不进预制产物的判据只有一条:**这内容是不是所有 attempt 都相同、且与本次实验的参数无关。** 按实验变化的内容(装不装某二进制、开不开预热)进 [`.setup()` 钩子](../library.md#沙箱生命周期钩子setup--teardown);按 eval 变化的任务夹具进 `test(t)`。

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
// docker build -t acme-codex-evals:2026-07-13 . 之后
sandbox: dockerSandbox({ image: "acme-codex-evals:2026-07-13" })
```

镜像只在构建机上时是单机可用;要在 CI 或多机消费,push 到项目自己的 registry,`image` 字段写完整引用。

### E2B:TemplateBuilder 派生

`niceeval/sandbox/e2b-template` 提供一个很薄的 **E2B 专属** factory `e2bCodingAgentTemplate(agent)`,从官方 coding agent 起点派生并返回原生 `TemplateBuilder`。用户可以继续链 E2B API,所以"官方基线"不会成为不能修改的黑盒:

```typescript
// scripts/build-e2b-template.ts
import { Template } from "e2b";
import { e2bCodingAgentTemplate } from "niceeval/sandbox/e2b-template";

const template = e2bCodingAgentTemplate("codex") // 从 E2B 官方 codex template 派生
  .aptInstall(["ripgrep", "jq"])
  .runCmd("corepack enable && pnpm --version")
  .copy("fixtures/toolchain.lock", "/opt/evals/toolchain.lock");

await Template.build(template, "acme-codex-evals:2026-07-13", {
  cpuCount: 2,
  memoryMB: 4096,
});
```

```bash
pnpm tsx scripts/build-e2b-template.ts
```

构建只在环境依赖变化时运行;日常 `niceeval exp` 直接消费项目自己的 alias:

```typescript
sandbox: e2bSandbox({ template: "acme-codex-evals:2026-07-13" })
```

Bub 若配置 `pythonPlugins`,模板 factory 要收到同一份 package 集合:`e2bCodingAgentTemplate("bub", { bubPythonPackages: ["bub-plugin-memory==1.3.0"] })`。Factory 与 Adapter 共用规范化和 hash 代码,插件顺序、空白和重复项不会制造假差异;集合真的不同则不会误用预装环境(指纹语义见 [Bub 接入页](../../adapters/sdk/bub/README.md))。

### Vercel Sandbox:从运行实例拍快照

Vercel 没有 template registry,也没有 Dockerfile;快照从一台跑起来的 microVM 拍出来。用 Vercel SDK 从官方 runtime(`node24`)起沙箱、装 Agent CLI、调 `.snapshot()` 拿到 `snap_...`,experiment 再引用这个 ID:

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

"没有跨 provider 构建 DSL"不等于每个项目都要从空白环境安装 coding agent。官方起点按所有权组合:

| Agent | E2B 起点 | 所有者与校验 |
|---|---|---|
| [Claude Code](../../adapters/sdk/claude-code/README.md) | E2B 官方 `claude` template | provider 维护 CLI;Claude Adapter 仍检查 `claude` |
| [Codex](../../adapters/sdk/codex-cli/README.md) | E2B 官方 `codex` template | provider 维护 CLI;Codex Adapter 仍检查 `codex` |
| [Bub](../../adapters/sdk/bub/README.md) | NiceEval 的固定版本配方 | NiceEval 固定 Bub 与 OTel 插件 commit,并写安装规格 marker;Bub Adapter 只信任指纹完全匹配的预装环境 |

NiceEval 已把三者构建成 E2B 公共模板。消费方不拼 namespace 或 release tag；从
`niceeval/sandbox/e2b-template` 的具名常量取得与当前 NiceEval 已验证基线配套的完整引用：

```typescript
import {
  NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  NICEEVAL_CODEX_E2B_TEMPLATE,
  NICEEVAL_BUB_E2B_TEMPLATE,
} from "niceeval/sandbox/e2b-template";

e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE })
e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })
e2bSandbox({ template: NICEEVAL_BUB_E2B_TEMPLATE })
```

返回值始终带完整跨 Team namespace 与已验证 release tag；release 选择属于 NiceEval 的发布知识，
下游不再维护或读取另一份易漂移的版本常量。派生模板如果需要把 base 身份编码进名字或
provenance，应直接使用所选完整 template ref。公开模板是 convenience baseline,不是 Adapter 的隐式默认值。

Adapter 不自动替 experiment 选择 template:同一个 Codex Adapter 可以跑 Docker、E2B 或 Vercel,选择权属于 sandbox spec;反过来,sandbox 也不猜要运行哪个 Agent。预装只是快速路径,各 agent 检测预装与回退安装的具体语义在各自的接入页(上表链接)。

## 新 provider 的预制环境义务

[接一个新 provider](../architecture.md#再接一个-provider)时,预制环境的故事随接口一起交付:

- **spec 上有一个消费字段**,语义是"从这个产物起实例"——对应 Docker 的 `image`、E2B 的 `template`、Vercel 的 `snapshotId`。字段名用该服务的原生词汇,不翻译成统一术语。
- **构建留在服务原生工具**:不为新 provider 发明 niceeval 构建命令,也不包一层构建 API;项目保留原生构建脚本,spec 只引用产物。
- **共享与过期语义如实文档化**:产物是账号私有还是可公开、会不会过期、跨 team 引用要什么 namespace,写进该 provider 的接入文档,不许诺服务给不了的可见性。
- **服务没有可发布产物原语时不伪造**:spec 不加假字段;该 provider 的用户用 [`.setup()` 钩子](../library.md#沙箱生命周期钩子setup--teardown)做运行时安装,或用下面的运行时 checkpoint 缓存安装结果。

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
