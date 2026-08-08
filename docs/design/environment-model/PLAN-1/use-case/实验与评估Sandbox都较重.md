# 实验与评估 Sandbox 都较重

返回 [PLAN-1 用例手册](README.md)。场景定义见根 [CASES · C3](../../CASES.md#c3评估与实验-sandbox-都较重)。

## 项目形态

每道 Eval 有自己的 Compose,不同 Experiment 又要增加不同工具。
例如 241 道 terminal-bench 题各自构建任务 Sandbox,记忆实验还要安装 mempal,普通对照实验则不安装。

两条变化轴分别声明,不构建「241 道题 × 每个实验变体」的组合 template。

## Eval 声明题目 Sandbox

```typescript
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
  }),
  async test(t) {
    await t.send(TASK_PROMPT);
  },
});
```

## Experiment 声明额外条件

```typescript
export default defineExperiment({
  agent: claudeCodeAgent({ mcpServers: [mempalMcp] }),
  sandbox: dockerSandbox(),
  provisions: [mempal],
});
```

每条 Attempt 先按 Eval Environment 构建并启动 Compose,再在 `workspaceService` 对应的 Sandbox 中确保 mempal 与 Agent CLI 就位。
Eval 不知道有哪些 Experiment Provision,Experiment 也不枚举 Eval Environment。

## 断网 Environment 使用 prepare

部分题目的 workspace 禁止访问外网时,直连 mempal Provision 若 inspect miss,安装动作无法满足 `installRequirements.network`。
这类 Experiment 使用宿主侧准备 payload 的 Provision:

```typescript
const identity = {
  version: MEMPAL_VERSION,
  payloadDigest: MEMPAL_TARBALL_SHA256,
  modelDigest: MEMPAL_MODEL_SHA256,
};

export const mempalOffline = defineProvision({
  name: "mempal",
  identity,
  installRequirements: { root: true },
  inspect: async (sandbox) => {
    const installed = await readMempalManifest(sandbox);
    return installed === undefined
      ? { installed: false, reason: "missing" }
      : { installed: true, identity: installed.identity };
  },
  prepare: async (ctx) => {
    const archive = join(ctx.stageDir, `mempal-${ctx.target.platform}.tar.gz`);
    await downloadMempalRelease(ctx.target.platform, archive);
    await verifySha256(archive, identity.payloadDigest);
    return { files: { archive } };
  },
  install: async (sandbox, ctx) => {
    await sandbox.uploadFile("/opt/staged/mempal.tar.gz", ctx.prepared.files.archive);
    await installMempalOffline(sandbox, "/opt/staged/mempal.tar.gz");
    await writeMempalManifest(sandbox, ctx.identity);
  },
});
```

prepare 在第一次 inspect miss 后启动。
同一 Provision identity 与目标平台只准备一次;amd64 与 arm64 使用不同 payload,不会因共享 key 误装。

## 两种缓存互相独立

- BuildKey 复用题目 Environment 的构建输出。
- Provision prepare 复用宿主侧 payload。
- 预构建 Sandbox 可以让 Provision inspect 直接命中。

`sandboxReuse` 不能让不同 EnvironmentKey 共用一个实例,也不是消除组合矩阵的前提。
只有同一个 Environment 的多个 Attempt 本来就允许共享 workdir 外状态时,才使用 Sandbox 复用。
