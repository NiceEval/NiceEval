# NiceEval-Eval：只分组两道当前项目题

契约单源始终在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本例展示同一目录里怎样显式列出部分 Eval，而不是让目录内容自动成组。

## 组定义

```ts
// evals/experiment/current-project.sandbox-group.ts
import { defineSandboxGroup } from "niceeval";
import repairFailing from "./repair-failing.eval.ts";
import runExisting from "./run-existing.eval.ts";

export default defineSandboxGroup({
  evals: [
    runExisting,
    repairFailing,
  ],
  onUnavailable: "replace-sandbox",
});
```

两道 Eval 都省略 `sandbox`，因此在编译期满足组成员类型；Node template 继续由 Experiment 提供。

`run-existing` 与 `repair-failing` 使用同一 Node profile，并反复安装同一候选 NiceEval。
任一 Experiment 同时选中两者时，它们自动轮流使用该 Experiment 的一台活跃 Sandbox；每次仍 reset workdir、上传本题 fixture，并重新执行 prepare。

`migrate-0.9` 没有出现在成员数组，因此使用 fresh Sandbox，并可与组内当前 Attempt 并行。
后来在同目录新增 Eval 时，它同样保持 fresh，直到作者显式修改成员数组。

`replace-sandbox` 表示缓存丢失时允许继续。
它不会把这组性能复用描述成连续业务状态。
