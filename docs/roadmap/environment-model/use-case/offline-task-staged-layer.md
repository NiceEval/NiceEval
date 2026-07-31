# 断网题装实验工具

## 解决什么问题

两头都重的死角:题有 241 种底座,把 mempal 这类工具烘进 template 就是 241 × 实验变体的制品矩阵。
其中一部分还是断网题——apply 在沙箱里拿不到外网,直连下载的装法根本走不通。

## 全流程

新契约下它就是[每题自带环境](per-task-environment.md)加一行 `layers`:

```typescript
// experiments/claude-docker--mempal.ts
export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox({ materializers: { compose: dockerComposeMaterializer() } })
    .setup(mempalLoadState())
    .teardown(mempalSaveState()),
  layers: [mempalStaged],          // 同一个层声明换 staged 变体,原样复用到 241 种任务底座上
  maxConcurrency: 1,
});
```

普通 `mempal` 层声明 `requires: { network: "direct" }`,在无网底座上计划期 `skipped`,不靠 apply 临场碰运气。
要跑断网题就换 staged 变体——宿主侧 `prepare` 取制品(run 级共享准备,同 identity 只下载一次),apply 纯离线安装,`requires` 不再声明网络:

```typescript
const mempalStaged = defineLayer({
  name: "mempal",
  identity: { version: MEMPAL_VERSION, payloadDigest: MEMPAL_TARBALL_SHA256 },
  prepare: async () => ({ files: { "mempal.tar.gz": await downloadMempalRelease(MEMPAL_VERSION) } }),
  apply: async (sandbox, ctx) => {
    await sandbox.uploadFile("/opt/staged/mempal.tar.gz", ctx.prepared.files["mempal.tar.gz"]);
    await sandbox.runShell("tar -xzf /opt/staged/mempal.tar.gz -C /usr/local && mempal --install-offline");
  },
});
```

每条 attempt:Docker 按 BuildKey 构建缺失 image、启动题目 Compose 并等待 ready → mempal 层 check / 安装 → agent 层 check / 安装 → 全栈复检 → 状态载入(每沙箱一次)→ agent 配置 → 跑题。

## 失败怎么归属

失败按发生点分三类,互不冒充(完整表见 [README](../README.md#能力协商与失败分层)):

- `requires` 与底座能力不相交:计划期 `skipped`;
- `prepare` 失败:run 级共享准备 `errored`;
- apply 或全栈复检失败:attempt `errored`,点名具体层、`reason` 与嫌疑层名单。
