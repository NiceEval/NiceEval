# Terminal-Bench:每题自包含，send 后普通跑测

契约单源见 [Library · 普通上传接受本地 URL](../library.md#普通上传接受本地-url)、[Architecture · Send 区间是唯一边界](../architecture.md#send-区间是唯一边界)与 [Lifecycle](../lifecycle.md)。

## 目标

每道题保留一份完整 `.eval.ts`。
不通过 Terminal-Bench Eval 工厂生成，也不把判分逻辑抽成共享函数。

NiceEval 不要求题目把普通文件再分类成 Fixture、Criteria 或 Private。
作者按真实顺序上传文件、运行官方脚本并断言退出码。

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

  async test(t) {
    await t.send("The networking on this machine is broken. Fix it so curl can reach example.com.");

    await t.sandbox.runShell("mkdir -p /tests", { root: true });
    await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests", {
      ignore: ["**/__pycache__/**"],
    });
    await t.sandbox.uploadFile("/tests/run-tests.sh", new URL("run-tests.sh", import.meta.url));

    const result = await t.sandbox.runShell(
      "TEST_DIR=/tests timeout --kill-after=10s 180s bash /tests/run-tests.sh",
      { root: true },
    );
    t.check(result, commandSucceeded());
  },
});
```

没有模块顶层 `await`、宿主同步 IO、文件登记 field 或特殊验证 callback。
`metadata` 也省略：benchmark 与 task 已由目录 id 和 tags 表达，没有消费者需要重复值。

## Runner 观察到什么

第一次 `send` 的区间只包含 Agent 自己的工作，因此 agent diff 不含后面的 `/tests`、venv、coverage 或 cache。

两个 URL 上传由普通 Sandbox 包装写入 transfer manifest。
后续运行可在派发前重算这些 source；测试文件变化会使本题重跑，未读取的 `solution.sh` 不参与本题身份。

Provider builder 写入 Compose build/mount closure。
判定封口前若发现实际上传的测试字节早已对 Agent 可见，本次 Attempt `errored`；Terminal-Bench 同时用 `.dockerignore` 从物理上隔离测试和 solution。

## Experiment

Experiment 只选择能消费 Compose source 的 SandboxSpec。
Sandbox creator 按 Attempt 分配 Compose project 名并接管日志，不要求每道 Eval 在模块顶层生成 nonce 或创建宿主目录。

Provider builder 不读取 instruction、测试脚本或 solution，也不生成 EvalDef。
每道 Eval 的定义仍完整留在自己的文件中。
