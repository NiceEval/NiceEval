# NiceEval-Eval：只分组两道当前项目题

契约单源始终在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本例展示同一目录里怎样显式列出部分 Eval，而不是让目录内容自动成组。

## 组定义

```ts
// evals/experiment/current-project.sandbox-group.ts
import { defineSandboxGroup } from "niceeval";

export default defineSandboxGroup({
  evals: [
    "./run-existing",
    "./repair-failing",
  ],
  onUnavailable: "replace-sandbox",
});
```

对应 Experiment 只引用组 id：

```ts
export default defineExperiment({
  evals: ["experiment/"],
  sandboxReuse: {
    groups: ["experiment/current-project"],
  },
  // 其它运行条件保持原样
});
```

`run-existing` 与 `repair-failing` 使用同一 Node profile，并反复安装同一候选 NiceEval。
两者轮流使用一台活跃 Sandbox；每次仍 reset workdir、上传本题 fixture，并重放 prepare。

`migrate-0.9` 没有出现在成员数组，因此使用 fresh Sandbox，并可与组内当前 Attempt 并行。
后来在同目录新增 Eval 时，它同样保持 fresh，直到作者显式修改成员数组。

`replace-sandbox` 表示缓存丢失时允许继续。
它不会把这组性能复用描述成连续业务状态。
