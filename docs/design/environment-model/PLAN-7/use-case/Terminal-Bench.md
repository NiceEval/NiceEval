# Terminal-Bench:每题自包含，turn 后运行官方测试

契约单源见 [Library · Criteria 只声明身份](../library.md#criteria-只声明身份)、[Library · afterAgent 是不可逆边界](../library.md#afteragent-是不可逆边界)与 [Lifecycle · Fresh Attempt](../lifecycle.md#fresh-attempt)。

## 目标

每道题保留一份完整 `.eval.ts`。
题目定义不通过 Terminal-Bench Eval 工厂生成，也不把判分逻辑抽到共享 helper。

NiceEval 只接管所有 Eval 都必须正确完成的机械契约：发现期身份、泄题检查、Agent 结束边界、归因与清理屏障。
上传文件、建目录、运行脚本和断言仍是普通 Sandbox / Eval API。

## 文件布局

```text
evals-next/
└── terminal-bench/
    └── broken-networking/
        ├── eval.ts
        ├── docker-compose.yaml
        ├── Dockerfile
        ├── run-tests.sh
        ├── tests/
        └── solution.sh
```

`run-tests.sh` 与 `tests/` 是 criteria。
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
    file: new URL("docker-compose.yaml", import.meta.url),
    mainService: "client",
    executionUser: "image",
  }),
  criteria: {
    runTests: { from: new URL("run-tests.sh", import.meta.url) },
    tests: {
      from: new URL("tests/", import.meta.url),
      ignore: ["**/__pycache__/**"],
    },
  },
  privateFiles: [new URL("solution.sh", import.meta.url)],

  async test(t) {
    await t.send("The networking on this machine is broken. Fix it so curl can reach example.com.");

    await t.afterAgent(async (after) => {
      await after.sandbox.runShell("mkdir -p /tests", { root: true });
      await after.sandbox.uploadDirectory(after.criteria.tests, "/tests");
      await after.sandbox.uploadFile("/tests/run-tests.sh", after.criteria.runTests);
      await after.sandbox.runShell("chmod +x /tests/run-tests.sh", { root: true });

      const result = await after.sandbox.runShell(
        "TEST_DIR=/tests timeout --kill-after=10s 180s bash /tests/run-tests.sh",
        { root: true },
      );
      after.check(result, commandSucceeded());
    });
  },
});
```

这份文件没有模块顶层 `await`，也没有 verifier 专用对象。
题目 id 只存在于目录路径和本题自己的路径声明中，不需要交给登记、挂载和运行函数各传一次。

## Runner 负责的部分

发现期，Runner 递归哈希两个 criteria source 与 private source，并对 Compose 的全部 build context 执行泄题门。

运行期，`afterAgent` 入口永久关闭 Agent 驱动面并冻结 agent diff。
callback 取得类型化 criteria handles 后，仍显式写出本题的普通上传目标、跑测命令与断言。

Runner 记录 handle 上传的目标并在 callback 结束后清理；测试脚本产生的 venv、coverage 与临时文件属于 after-Agent 归因，并进入 Attempt reset/teardown 屏障。
本题不需要写 `diff.ignore` 来保护 agent diff。

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

materializer 只兑现上游 Compose 协议，不读取 instruction、criteria 或 solution，也不生成 EvalDef。
它还按 Attempt 分配 Compose project 名并接管运行日志，不要求每道 Eval 在模块顶层生成 nonce 或创建宿主日志目录。
每道 Eval 的定义仍完整留在自己的文件中。
