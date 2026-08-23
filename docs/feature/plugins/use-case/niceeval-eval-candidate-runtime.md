# NiceEval-Eval 的候选 Runtime 条件

## 现有用例

NiceEval-Eval 用同一套题比较多个候选 NiceEval 版本。一个 harness 候选同时决定:

- 精确 `candidateVersion` flag;
- Dockerfile build args 与 target;
- 候选版 NiceEval、随包文档与 INIT 生成文件;
- physical Sandbox setup 中由 entrypoint 写入候选工作区;
- Node、pnpm、Docker / Compose、执行身份、候选 CLI 版本与“尚未混入 case 源码”的就绪验证。

当前每份 Experiment 先在模块顶层 `await ensureCandidate(target)`,再把查得的精确版本同时传给 flags 与 `sandboxWith(profile, version)`。这保证了几项值相同,但只有候选查找函数与 Sandbox factory 的调用惯例在维持一致。候选 Runtime Plugin 只组合稳定行为 identity 与生命周期；它不写 Plugin provenance Attachment 或任何其它 Record 事实。

## 适合插件化的部分

在精确版本与兼容 template 已经选定后，候选 Runtime 可以成为 Experiment 的 Plugin occurrence：

```ts
const candidate = { version: "0.12.0" } as const;

export default defineExperiment({
  ...harnessBase,
  flags: { ...harnessBase.flags, candidateVersion: candidate.version },
  labels: { ...harnessBase.labels, candidate: candidate.version },
  sandbox: candidateHarnessSandbox({
    version: candidate.version,
    runtime: "node",
  }),
  plugins: pluginStack()
    .use(candidateRuntime({
      version: candidate.version,
      runtime: "node",
    })),
});
```

Experiment 明确拥有 `candidateVersion` flag 与报告 label：前者是会改变执行的条件，后者只用于归类；Plugin 不能代替调用点写入或改写二者。

`candidateRuntime()` 可以成套贡献:

- physical Sandbox lifecycle setup，把候选工作区写入实例并执行就绪检查；
- 对应的 teardown，以及生命周期中的 progress / diagnostic；
- 由 `{ version, runtime }` 组成的稳定行为 identity，使同一 Plugin occurrence 只在同一候选条件下参与 reuse identity。

Node / pnpm / Docker / Compose 的实际检查值、setup provenance 与 contribution refs 不是 Plugin 可自定义的持久数据。它们只有恰好符合 NiceEval 已发布 typed collector 或 Adapter 能力时，才能进入九个固定 family 中对应的 source、File Changes、Assertions、Sources 或 Artifacts；没有 collector 时不自动持久化或查询。

这样同一个插件可用于 stable、previous 与 canary 三格；每个 Experiment link 出独立 instance，不会共享 setup 状态或取得 Record writer capability。

第三方 Plugin 只能组合 lifecycle / domain API。它不能取得 durable writer、读取面、family catalog、schema、blob、migration 或物理 Record 布局权限，也不能注册新的 Attachment family；新增值得持久化的事实必须先由 NiceEval 定义和版本治理。

## 不能收进插件的部分

示例中的 `candidate` 是前置工作流已经锁定的精确身份,不是在 Experiment 模块 import 时查询出来的值。插件不解决移动 dist-tag 的网络查找。当前 `ensureCandidate("canary")` 会访问 npm registry、下载 tarball、读取随包文档清单并探活 GitHub INIT;这些动作发生在模块 import 期,还会让未选中的 Experiment 因公网抖动一起加载失败。

`definePlugin()` 不能把这段 I/O 伪装成纯 activation。理想入口需要另一个显式的候选下载 / 锁定步骤,先把移动 tag 查成可签入或可缓存的精确 candidate identity;插件只消费完成态精确值，不能以候选查找结果建立新的持久事实。

插件也不能提供 `dockerImage()`、修改 build args / target、选择 raw-privileged 或 managed-rootless DinD、设置 tmpfs 与 read-only rootfs。这些字段共同定义 template 与物理资源身份,仍由调用点的显式 template 声明拥有。

因此这条用例的职责线是:

```text
候选查找 / 下载       → 独立资源工作流,返回精确 version
Sandbox template      → candidateHarnessSandbox({ version, runtime })
候选运行条件与验收   → plugins: pluginStack().use(candidateRuntime({ version, runtime }))
```

插件可以检查 template 完成后的 Sandbox 实例，但不能反过来修改 template 让它“碰巧兼容”，也不能把检查细节作为自定义 Record 值写入。V1 不提供通用 planning requirement 求解器。
