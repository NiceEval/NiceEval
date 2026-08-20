# Fixture 内容命令 —— Library

## 导出

```ts
import { putFixture } from "niceeval/sandbox";
```

## 签名

```ts
interface PutFixtureOptions {
  readonly id: string;
  readonly revision: string;
  readonly source: URL;
  readonly target: string;
}

declare function putFixture(options: PutFixtureOptions): StableSandboxCommand;
```

`id` 与 `revision` 使用 `defineSandboxCommand()` 的同一校验规则。
`source` 必须是 `file:` URL，并使用 `registerSandboxContent(URL)` 的 symlink 与文件类型语义。
调用点应以 `new URL("./fixture/", import.meta.url)` 明确绑定定义模块；短写不接受依赖 cwd 或隐式项目根的字符串路径。
`target` 使用 `SandboxCommandTarget.putContent()` 的 Sandbox path 语义。

## Eval-owned fixture

```ts
const taskRepo = putFixture({
  id: "task-repo",
  revision: "1",
  source: new URL("./fixture/", import.meta.url),
  target: "/workspace/task",
});

export default defineEval({
  sandbox: sandboxLayer().prepare(taskRepo),
  async test(t) {
    await t.send("修复 /workspace/task 中的实现。");
  },
});
```

这份内容随 Eval 变化，归 Eval layer。

## Experiment-owned fixture

```ts
const experimentConfig = putFixture({
  id: "mempal-config",
  revision: "2",
  source: new URL("./fixtures/mempal.json", import.meta.url),
  target: "/etc/niceeval/mempal.json",
});

export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({ template: "niceeval-agents" })
    .prepare(experimentConfig),
});
```

这份内容随 Experiment 配置变化，归 Experiment layer。
API 不根据 source 目录名自动选择 owner。

## 等价展开

语义等价于：

```ts
const content = registerSandboxContent(options.source);

defineSandboxCommand(
  {
    id: `fixture/${options.id}`,
    revision: options.revision,
    inputs: {
      content,
      target: options.target,
    },
  },
  async (sandbox) => {
    await sandbox.putContent(content, options.target);
  },
);
```

实现可以共享内部传输计划，但公开可观察结果必须与这段展开一致。
