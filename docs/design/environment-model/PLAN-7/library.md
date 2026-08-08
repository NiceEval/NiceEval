# PLAN-7 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## EvalDef 不增加文件字段

```typescript
interface EvalDef {
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly timeoutMs?: number;
  readonly environment?: string | SandboxSource;
  readonly metadata?: Readonly<Record<string, unknown>>;

  setup?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  teardown?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  test(t: TestContext): Promise<void> | void;
}
```

`metadata` 是确有消费者时使用的结构化附注 escape hatch。
能从 eval id、tags、description 或 Environment 推导出的值不重复写进 metadata。

## 普通上传接受本地 URL

```typescript
interface Sandbox {
  uploadFile(path: string, content: Buffer | URL): Promise<void>;
  uploadDirectory(
    localDir: string | URL,
    targetDir?: string,
    options?: { ignore?: readonly string[] },
  ): Promise<void>;
}
```

`URL` 按标准 URL 语法 parse；folder Eval 通常用 `new URL("tests/", import.meta.url)`。
字符串 local path 仍以 Eval 模块目录为基准换算。

`uploadFile` 的 `Buffer` 表示运行期已在内存中的普通二进制内容。
`URL` 与 `uploadDirectory` 的 local source 表示宿主文件依赖；Runner 自动写入实际读取的文件树，不要求作者另行登记。

目录按稳定相对路径顺序展开。
`ignore` 只过滤该 source 下的相对路径；source 不存在、逃出项目根或目录为空时在调用点报错。

## 顺序就是可见性

```typescript
async test(t) {
  await t.send("完成任务。");

  await t.sandbox.runShell("mkdir -p /tests", { root: true });
  await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests", {
    ignore: ["**/__pycache__/**"],
  });
  await t.sandbox.uploadFile("/tests/run-tests.sh", new URL("run-tests.sh", import.meta.url));

  const result = await t.sandbox.runShell("bash /tests/run-tests.sh", { root: true });
  t.check(result, commandSucceeded());
}
```

这段代码没有特殊验证相位。
若后面再调用 `t.send()`，下一轮看见 `/tests`，与普通 Sandbox 状态完全一致。

## Transfer manifest

每次普通本地上传写入:

```typescript
interface LocalTransferInput {
  readonly source: string;       // 项目相对路径
  readonly kind: "file" | "directory";
  readonly files: readonly { path: string; sha256: string }[];
  readonly target: string;
  readonly interval: "before-first-send" | "between-sends" | "after-last-send";
}
```

这是 Attempt 证据，不是 EvalDef 作者 API。
Buffer 上传写入目标与 activity，但没有可供下一次运行重算的宿主 source。

carry planner 只复用由上次真实执行产生、且 Eval 源码闭包仍相同的 transfer manifest。
任何 source 内容或匹配集变化都使对应 Attempt 重跑。

## metadata 的边界

`metadata` 有真实消费者：Experiment 谓词与自定义 Reporter 可以读取结构化业务维度。
它不参与文件身份、生命周期或 Sandbox 准备。

Terminal-Bench 的 `benchmark` 与 `task` 已由路径和 tags 表达，因此示例不写 metadata。
