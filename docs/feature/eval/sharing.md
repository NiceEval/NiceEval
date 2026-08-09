# 共享 Eval —— 在项目文件中显式引用外部题目

共享 Eval 与本地 Eval 使用同一套 Experiment 选择模型。区别只在定义文件：本地文件导出
`defineEval`，需要复用上游 package 中某一道题时，消费项目新增一个导出 `defineRemoteEval` 的文件。

安装 package 本身不会发现或加入任何 Eval。这个文件就是消费项目对共享题目的显式声明，也因此会进入项目自己的 Git
变更和 Eval catalog。

## 消费方写一个引用文件

```text
consumer/
├── package.json
├── package-lock.json
├── evals/
│   ├── smoke.eval.ts
│   └── terminal-bench/
│       └── hello-world.eval.ts
└── experiments/
```

```typescript
// evals/terminal-bench/hello-world.eval.ts
import { defineRemoteEval } from "niceeval";

export default defineRemoteEval({
  package: "terminal-bench",
  root: "evals/terminal-bench",
  eval: "hello-world",
});
```

`package` 必须是消费项目的直接 dependency。`root` 是 package 内的 Eval 目录，省略时使用 `evals`。`eval` 是
上游导出的精确 Eval ID，不接受 glob、prefix 或整棵目录导入。

引用文件的路径形成消费项目内的 Eval ID；上例的 ID 是 `terminal-bench/hello-world`。需要改题目时应复制成新的本地
Eval，而不是对远程引用做 patch、override 或 alias。

## Experiment 选择不变

远程引用和本地 Eval 进入同一个 catalog，Experiment 仍使用原来的 `evals` selector：

```typescript
export default defineExperiment({
  agent: myAgent,
  evals: ["smoke", "terminal-bench/hello-world"],
});
```

也可以继续使用既有的 `"*"`、ID 前缀或 `EvalDescriptor` 谓词。因为只有项目文件显式声明的远程引用才会进入 catalog，
新增 package 不会意外扩大既有实验。

`niceeval list` 显示本地 Eval 与这些引用文件产生的 Eval；未被 `defineRemoteEval` 引用的已安装 package 完全不可见。

## 运行前的安装身份校验

`defineRemoteEval` 返回惰性 descriptor，不在配置或 Eval 文件导入时执行上游代码。运行前 NiceEval 会：

1. 验证 package 是直接依赖，并由 npm、pnpm 或 Yarn node-modules lockfile 固定；
2. 定位已安装 package 的真实物理路径，确认 `root` 位于 package owner 内；
3. 导入并定位精确的上游 Eval ID；
4. 写入 package、root、upstream Eval ID、lock identity 和源码/模块 provenance；
5. 对外部 Eval 的路径、Fixture、Sandbox 输入执行与本地 Eval 相同的 owner containment 和 leak gate。

上游 package 拥有题目、断言、Fixture、Sandbox 和题目模块；消费项目的 Experiment 拥有 agent、model、attempts、flags、
预算和选择范围。远程 Eval 的安装身份改变时，当前契约让它整体失去跨 Run carry eligibility；逐题跨版本 transfer 属于后续独立
设计。

Yarn Plug'n'Play 没有可核验的 node-modules owner tree，当前契约明确拒绝。未安装或 lock 无法证明的 package 不会静默降级为
本地题目，而是返回结构化 `eval-root.*` 诊断。

## 发布方不需要专用协议

发布方继续发布普通 NiceEval package：普通 `package.json`、Eval 文件、运行期 dependencies 和随包 Fixture 即可。不
需要 suite manifest、registry、adapter 或 `eval.lock`。package manager 的 lockfile 是依赖树与版本身份的唯一真相；
NiceEval 只验证并写入对应的 provenance facts。

## 设计边界

当前契约保留 package-manager 安装身份、lock、路径 owner、源码捕获、模块依赖和 provenance 校验；不自动扫描 package、
不把整个 root 加入 catalog、不支持远程题目 patch/alias，也不承诺 package 升级后的逐题精确 transfer。

未来可以增加显式的 package inspect 命令、发布侧共享清单或 derived Eval API，但这些都不改变当前文件级声明与原有
Experiment 选择契约。

推荐入口是文件级 `defineRemoteEval`；旧版 `defineConfig({ evalRoots: ... })` 自动挂载模型仅作为迁移兼容路径保留。

公开操作步骤见[共享评估教程](../../../docs-site/zh/tutorials/share-evals.mdx)。设计取舍见[共享 Eval 设计存档](../../design/eval-suite-sharing/DECISION.md)。
