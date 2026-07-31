# 环境层 —— 库 API

模型与裁决理由见 [README](README.md);场景化的完整示例在[用例手册](use-case/README.md)。
本篇只写 API 面:`defineLayer` 与 `experiment.layers` 是新原语,environment profile / sandbox source、Fixture 与 Provider 选择沿用现行契约。

## `defineLayer(spec)`

从 `niceeval/sandbox` 导出,返回一个可放进 `experiment.layers` 的层声明:

```typescript
import { defineLayer } from "niceeval/sandbox";

const layer = defineLayer({
  name: "mempal",
  identity: { version: "0.9.0", installerDigest: SHA256 },
  requires: { network: "direct" },
  check: async (sandbox) => ({ ok: true }),
  apply: async (sandbox, ctx) => { /* 缺失时补齐 */ },
});
```

| 字段 | 类型 | 契约 |
| --- | --- | --- |
| `name` | `string` | `[a-z0-9-]`;同一层栈内唯一,重复在启动期报配置错误;是 activity 与 facts key 的组成部分 |
| `identity` | 纯数据对象 | 整体进 fingerprint;必须覆盖 apply 消费的一切有语义输入,义务清单见 [README · 身份契约](README.md#身份契约覆盖一切有语义的输入) |
| `requires` | 纯数据对象,可选 | 规划期能力协商;字段与语义见下 |
| `check` | `(sandbox) => Promise<LayerCheckResult>` | 判定层是否已就位;每 attempt 执行,结构见下 |
| `apply` | `(sandbox, ctx) => Promise<void>` | check 未命中才执行;写入落在 workdir 之外([README · 写入边界](README.md#写入边界层不写-workdir)) |
| `prepare` | `(ctx) => Promise<PreparedPayload>`,可选 | 宿主侧半边:run 级共享准备,同 identity single-flight;staged payload 写进 `ctx.stageDir`、以宿主路径返回,经 `ctx.prepared` 交给 apply |

`ctx` 与 sandbox Hook 的窄上下文同源:`progress` / `diagnostic` / `fact`、`signal`、`experimentId`。
`prepare` 的 ctx 另带 `stageDir`(框架按层 identity 分配的 run 级暂存目录),apply 的 ctx 另带 `prepared`(键到宿主路径的表)。
staged payload 走文件系统不走内存字节,语义见 [README · staged 准备](README.md#staged-准备prepare-是层的宿主侧半边)。

### `LayerCheckResult`

```typescript
type LayerCheckResult =
  | { ok: true; actual?: Record<string, string> }          // 实测身份,落 facts
  | { ok: false; reason: string; detail?: string };        // reason 是开放诊断词表
```

`ok` 是判别轴;`reason` 用 `missing` / `version-mismatch` / `permission` 这类开放词表。
`actual` 与 `detail` 会落盘:只放提炼后的非敏感短值,框架另做固定长度截断(义务见 [README · check 的返回](README.md#check-的返回是结构化结果不是布尔))。

### `requires`

```typescript
requires: {
  platform: ["linux/amd64", "linux/arm64"],   // 省略 = 不挑平台
  root: true,                                  // 需要提权执行;省略 = 不需要。没有「禁止 root」这种层需求
  network: "direct",                           // apply 需要沙箱侧外网;省略 = 不需要
}
```

协商只做静态可判的一侧:sandbox case 声明了无网而 Layer 要 `direct`,规划期 `skipped`;运行期断网按 apply 失败归属。
断网 sandbox case 上要装东西,用 `prepare` 变体——完整走法见[用例:断网题装实验工具](use-case/offline-task-staged-layer.md)。

## `experiment.layers`

```typescript
export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  layers: [mempal],        // 有序;experiment 层在前,agent 层由 adapter 自动追加在最后
});
```

- 执行协议:逐层 check → 缺失 apply → 全栈复检(零 apply 的 attempt 跳过复检);失败归属见 [README · 能力协商与失败分层](README.md#能力协商与失败分层)。
- 调用点与状态 Hook、`agent.setup` 的相对顺序见 [README · 生命周期位置](README.md#生命周期位置)。
- `sandboxReuse` 下 check 每 attempt 执行,apply 只补缺;状态 Hook 保持每沙箱一次。

## 记录面

- 逐层计时:`sandbox.layer.<name>.check` / `sandbox.layer.<name>.apply` activity。
- 运行事实:`layer.<name>.hit`、check 的 `actual` 落 `AttemptRecord.facts`。
- 复用窗口:`sandbox.window.id` / `sandbox.window.seq` 落 facts;回存失败发 `sandbox-state-save-failed` 诊断,语义见 [README · 复用语义](README.md#复用语义层每-attempt状态每沙箱)。

## 相关阅读

- [用例手册](use-case/README.md) —— 三个真实形态与烘产物的完整代码路径。
- [README](README.md) —— 层原语契约、身份规则、生命周期位置与迁移面。
- [Sandbox Case](../../feature/sandbox/case.md) —— environment profile / sandbox source、`environments` 表与缺失判定。
- [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) —— agent 层的协议原型。
