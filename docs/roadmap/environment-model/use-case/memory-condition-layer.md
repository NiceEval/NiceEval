# 记忆对照:mempal 装成 experiment 层

## 解决什么问题

所有题共用同一个不含 mempal 的 E2B template,重的是随 experiment 变的工具:mempal 的二进制、模型 cache、skill 文件。
这套东西在旧写法里要凑三件事:派生 template 命名(`mempalTemplate("codex")`)、`.setup()` Hook 里装二进制加预热、flags 背环境身份。
新写法一件:声明一个层。

## 全流程

```typescript
// experiments/shared/mempal.ts
import { createHash } from "node:crypto";
import { defineLayer } from "niceeval/sandbox";

export const MEMPAL_VERSION = "0.9.0";
const INSTALLER_DIGEST = createHash("sha256").update(MEMPAL_INSTALL_SH).digest("hex");

export const mempal = defineLayer({
  name: "mempal",
  identity: {
    version: MEMPAL_VERSION,
    installerDigest: INSTALLER_DIGEST,          // 安装脚本改一个字节,身份就变,旧结果不再携带
    model: "minilm-l6@sha256:9f2c…",            // 预热的 embedding 模型也是环境语义
  },
  requires: { network: "direct" },
  check: async (sandbox) => {
    const probe = await sandbox.runCommand("mempal", ["--version"]);
    if (probe.exitCode !== 0) return { ok: false, reason: "missing" };   // detail 要落盘:只放提炼后的非敏感短值
    if (!probe.stdout.includes(MEMPAL_VERSION))
      return { ok: false, reason: "version-mismatch", detail: probe.stdout.trim() };
    return { ok: true, actual: { version: probe.stdout.trim() } };
  },
  apply: async (sandbox, ctx) => {
    ctx.progress({ message: `installing mempal ${MEMPAL_VERSION}`, current: 1, total: 2 });
    await sandbox.runShell(MEMPAL_INSTALL_SH);
    ctx.progress({ message: "warming embedding model", current: 2, total: 2 });
    await sandbox.runCommand("mempal", ["warmup"]);   // 逐层计时会记下这步花了多久
  },
});
```

```typescript
// experiments/compare/codex--mempal.ts
export default defineExperiment({
  description: "codex · gpt-5.6-luna(mempal)",
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  model: "gpt-5.6-luna",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })   // 官方基线,没烘 mempal
    .setup(mempalLoadState())      // 状态 Hook 跑在层栈之后:载入时 mempal 已就位
    .teardown(mempalSaveState()),  // 回存
  layers: [mempal],
  flags: { memory: "mempal" },     // 只用于分组展示;环境身份由 Layer identity 序列与 CaseKey 承载
  maxConcurrency: 1,               // [载入…回存] 是临界区
});
```

对照组就是没有那行 `layers` 的另一份实验文件。
层与状态 Hook 同模块成对导出:`mempal.ts` 里还导出 `mempalLoadState` / `mempalSaveState`,实验文件按对取用——状态挂 Hook 链而非层的裁决见 [README · Hook 收窄](../README.md#hook-收窄只剩状态不再装环境)。

## 得到什么

消掉的东西:派生 template 的命名体操与重构建、每 attempt 无条件重装、「template 名 + flags」双轨背身份。
换 agent(claude / codex / bub)不再触发「agent × 实验变体」的模板矩阵:同一个 `mempal` Layer 在能力相容的 sandbox case 上都走「check → 缺失 apply → 全栈复检」(相容判定见 [README · 能力协商](../README.md#能力协商与失败分层))。
这次是命中还是现场装、实测版本是多少,都在 `facts`(`layer.mempal.hit` 这类)与逐层计时里留档。
