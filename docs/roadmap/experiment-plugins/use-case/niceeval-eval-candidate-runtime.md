# NiceEval-Eval 的候选 Runtime 条件

## 现有用例

NiceEval-Eval 用同一套题比较多个候选 NiceEval 版本。一个 harness 候选同时决定:

- 精确 `candidateVersion` flag;
- Dockerfile build args 与 target;
- 候选版 NiceEval、随包文档与 INIT 生成文件;
- physical Sandbox setup 中由 entrypoint 写入候选工作区;
- Node、pnpm、Docker / Compose、执行身份、候选 CLI 版本与“尚未混入 case 源码”的就绪验证。

当前每份 Experiment 先在模块顶层 `await ensureCandidate(target)`,再把查得的精确版本同时传给 flags 与 `sandboxWith(profile, version)`。这保证了几项值相同,但只有候选查找函数与 Sandbox factory 的调用惯例在维持一致,Record 看不出它们共同属于一个 candidate-runtime 条件。

## 适合插件化的部分

在精确版本与兼容 template 已经选定后,候选 Runtime 可以成为 Experiment Plugin:

```ts
const candidate = { version: "0.12.0" } as const;

export default defineExperiment({
  ...harnessBase,
  sandbox: candidateHarnessSandbox({
    version: candidate.version,
    runtime: "node",
  }),
  plugins: [
    candidateRuntime({
      version: candidate.version,
      runtime: "node",
    }),
  ],
});
```

`candidateRuntime()` 可以成套贡献:

- `candidateVersion` flag 与报告 label;
- physical Sandbox setup 写入候选工作区并执行就绪检查;
- Node / pnpm / Docker / Compose 版本 facts;
- 对 requested Docker access、资源与 runtime profile 的 typed planning requirements;
- 静态 candidate identity 与 setup provenance。

这样同一个插件可用于 stable、previous 与 canary 三格;每个 Experiment link 出独立 instance,不会共享 setup 状态。

## 不能收进插件的部分

示例中的 `candidate` 是前置工作流已经锁定的精确身份,不是在 Experiment 模块 import 时查询出来的值。插件不解决移动 dist-tag 的网络查找。当前 `ensureCandidate("canary")` 会访问 npm registry、下载 tarball、读取随包文档清单并探活 GitHub INIT;这些动作发生在模块 import 期,还会让未选中的 Experiment 因公网抖动一起加载失败。

`defineExperimentPlugin()` 不能把这段 I/O 伪装成纯 activation。理想入口需要另一个显式的候选下载 / 锁定步骤,先把移动 tag 查成可签入或可缓存的精确 candidate identity;插件只消费完成态精确值。

插件也不能提供 `dockerfileSandbox()`、修改 build args / target、选择 raw-privileged 或 managed-rootless DinD、设置 tmpfs 与 read-only rootfs。这些字段共同定义 template 与物理资源身份,仍由 `candidateHarnessSandbox()` 一类显式 template factory 拥有。

因此这条用例的职责线是:

```text
候选查找 / 下载       → 独立资源工作流,返回精确 version
Sandbox template      → candidateHarnessSandbox({ version, runtime })
候选运行条件与验收   → plugins: [candidateRuntime({ version, runtime })]
```

插件 requirement 可以核对 template completed plan 是否满足候选 Runtime,但不能反过来修改 template 让它“碰巧兼容”。
