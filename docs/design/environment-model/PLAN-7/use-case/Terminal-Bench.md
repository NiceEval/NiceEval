# Terminal-Bench:每题自包含，turn 后运行官方 verifier

契约单源见 [Library · 隐藏 verifier](../library.md#隐藏-verifier)与 [Lifecycle · Fresh Attempt](../lifecycle.md#fresh-attempt)。

## 目标

每道题保留一份完整 `.eval.ts`。
题目定义不通过 Terminal-Bench Eval 工厂生成，也不把判分逻辑抽到共享 helper。

NiceEval 只接管所有 Eval 都必须正确完成的生命周期机械动作:发现期指纹、泄题检查、按相位上传、归因与清理。

## 文件布局

```text
tasks/
└── broken-networking/
    ├── task.yaml
    ├── docker-compose.yaml
    ├── Dockerfile
    ├── run-tests.sh
    ├── tests/
    └── solution.sh
evals/
└── terminal-bench/
    └── broken-networking.eval.ts
```

`run-tests.sh` 与 `tests/` 是 verifier files。
`solution.sh` 是 private file；三者都必须被 Docker build context 排除。

## 自包含 Eval

```typescript
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import { composeSandbox } from "niceeval/sandbox";

export default defineEval({
  description: "broken-networking: restore outbound networking",
  tags: ["terminal-bench", "single-service", "networking"],
  timeoutMs: 21 * 60_000,
  environment: composeSandbox({
    file: new URL("../../tasks/broken-networking/docker-compose.yaml", import.meta.url),
    mainService: "client",
    executionUser: "image",
  }),
  privateFiles: [new URL("../../tasks/broken-networking/solution.sh", import.meta.url)],

  async test(t) {
    await t.send("The networking on this machine is broken. Fix it so curl can reach example.com.");
  },

  verifier: {
    files: [
      {
        from: new URL("../../tasks/broken-networking/run-tests.sh", import.meta.url),
        to: "/tests/run-tests.sh",
      },
      {
        from: new URL("../../tasks/broken-networking/tests/", import.meta.url),
        to: "/tests",
      },
    ],
    async verify(v) {
      const result = await v.sandbox.runShell(
        "TEST_DIR=/tests timeout --kill-after=10s 180s bash /tests/run-tests.sh",
        { root: true },
      );
      v.check(result, commandSucceeded());
    },
  },
});
```

这份文件没有模块顶层 `await`。
题目 id 只存在于目录路径、Eval 文件名和本题自己的路径声明中，不需要交给登记函数、挂载函数和运行函数各传一次。

## Runner 负责的部分

发现期，Runner 递归哈希两个 verifier source 与 private source，并对 Compose 的全部 build context 执行泄题门。

运行期，Runner 在 `test(t)` 返回后冻结 agent diff，再把 verifier files 上传到声明的目标。
`verify(v)` 只写本题真正的判分命令与断言。

判分结束后，Runner 删除 `/tests` 受管材料。
测试脚本产生的 venv、coverage 与临时文件属于 verification 归因，不要求本题写 `diff.ignore` 来保护 agent diff。

## Experiment

Experiment 选择能消费 Compose source 的 SandboxSpec。
Terminal-Bench 上游 Compose 所需的日志路径、容器命名和插值规则属于 materializer compatibility，不在每道 Eval 里重复:

```typescript
export default defineExperiment({
  evals: ["terminal-bench/"],
  sandbox: dockerSandbox({
    materializers: {
      compose: terminalBenchComposeMaterializer(),
    },
  }),
  agent: codexAgent(),
});
```

materializer 只兑现上游 Compose 协议，不读取 instruction、判据或 solution，也不生成 EvalDef。
每道 Eval 的定义仍完整留在自己的文件中。
