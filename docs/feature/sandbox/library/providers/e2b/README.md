# E2B

`e2bSandbox()` 从 E2B template 创建云端微 VM。factory 的公共形状见 [Library · 起点参数](../../README.md#起点参数与-lifetimems)，Before cache 见 [E2B Provider 架构 · 远端 snapshot driver](../../../architecture/providers/e2b.md#远端-snapshot-driver)，内部实现见 [E2B Provider 架构](../../../architecture/providers/e2b.md)。

## 预制实例

`niceeval/sandbox/e2b-template` 提供一个很薄的 **E2B 专属** factory `e2bCodingAgentTemplate(agent)`,从官方 coding agent 起点派生并返回原生 `TemplateBuilder`。用户可以继续链 E2B API,所以"官方起点"不会成为改不动的封闭件:

Factory 同时收敛 Node 工具安装面的三件事：运行用户的 `npm prefix -g` 是 `/usr/local`，`/usr/local/bin` 已在 PATH，`/usr/local/bin` 与 `/usr/local/lib/node_modules` 对运行用户可写。E2B 官方 `claude` 与 `codex` 起点的 Node 路径和默认 prefix 不同，这层规范化是 NiceEval 派生 baseline 的职责；否则同一条 eval 的 `npm install -g` 会只因换 Agent 而成片失败。

因此项目追加全局 Node 工具用普通 `npm install -g <pkg>`，不需要按 Agent 分支，也不需要 sudo。

同一层还收敛[跨 provider 起点工具面](../../prebuilt-environments.md#跨-provider-起点工具面)：官方起点若带 yarn 实体就移除，python3 存在与否被断言。`verifyE2BNodeToolContract(template)` 把这些断言链进 build，任一项漂移时模板在写入 registry 前构建失败——这也是[官方公共起点](../../prebuilt-environments.md#官方-coding-agent-起点)的发布门槛。

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

构建只在依赖变化时运行;日常 `niceeval exp` 直接消费项目自己的 alias:

```typescript
sandbox: e2bSandbox({ template: "acme-codex-evals:0.144.1-r1" })
```

Bub 若配置 `pythonPlugins`,模板 factory 要收到同一份 package 集合:`e2bCodingAgentTemplate("bub", { bubPythonPackages: ["bub-plugin-memory==1.3.0"] })`。Factory 与 Adapter 共用规范化和 hash 代码,插件顺序、空白和重复项不会制造假差异;集合真的不同则不会误用预装实例(指纹语义见 [Bub 接入页](../../../../adapters/library/sdk/bub/README.md))。

## 现场接入与回收

原生 CLI 的分工见 [CLI · 原生 CLI 现场接入与资源管理](../../../cli.md#原生-cli-现场接入与资源管理)。E2B 的留存为 pause：

- 进入：`e2b sandbox connect <sandboxId>`；
- 销毁：`e2b sandbox kill <sandboxId>`。
