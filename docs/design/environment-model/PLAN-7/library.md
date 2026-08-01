# PLAN-7 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## EvalDef

```typescript
type EvalCriteria = Readonly<Record<string, EvalFileSource>>;

interface EvalDef<C extends EvalCriteria = {}> {
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly timeoutMs?: number;
  readonly environment?: string | SandboxSource;
  readonly fixture?: EvalFixture;
  readonly criteria?: C;
  readonly privateFiles?: readonly EvalFileSource[];

  setup?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  teardown?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  test(t: TestContext<C>): Promise<void> | void;
}
```

`test(t)` 负责驱动 Agent、读取结果，并在需要 turn 后操作时显式跨过 `afterAgent` 边界。
静态文件的内容身份不靠模块顶层 loader 或运行期宿主读盘表达。

## 受管文件 source

```typescript
type EvalFileSource =
  | string
  | URL
  | {
      readonly from: string | URL;
      readonly ignore?: readonly string[];
    };

interface EvalFileMount {
  readonly from: EvalFileSource;
  readonly to: string;
}
```

source 可以指向普通文件或目录。
目录按稳定路径顺序递归展开，`ignore` 使用项目统一 glob 语义。

字符串从项目根解析，URL 按标准 URL 语义解析。
发现期要求 source 存在、留在项目根内，且不能经符号链接逃出项目根。
文件内容、相对路径与类型进入身份；mtime 不进入身份。

## 可见 Fixture

```typescript
interface EvalFixture {
  readonly files: readonly EvalFileMount[];
}
```

`fixture.files` 同时声明 source 与 Sandbox 目标，因为它的上传时机固定为 Agent 前。
Runner 在 EvalDef setup 后、Agent setup 前上传这些文件；它们进入 Eval 数据指纹并记为 eval 归因。

动态准备继续写在 `setup`。
例如 checkout、创建外部临时 repo 或根据运行时凭据生成配置，不伪装成静态文件声明。

## Criteria 只声明身份

```typescript
const evalDef = defineEval({
  criteria: {
    runTests: { from: new URL("run-tests.sh", import.meta.url) },
    tests: {
      from: new URL("tests/", import.meta.url),
      ignore: ["**/__pycache__/**"],
    },
  },
  async test(t) {
    // ...
  },
});
```

`criteria` 是 keyed record，key 只在当前 Eval 内命名 handle。
它没有 `to`，不自动上传，也不规定这些文件一定用于“verify”。

Runner 在发现期解析每个 source，写入判据指纹并执行泄题门。
运行期只有 `afterAgent` callback 能取得 `after.criteria.<key>`；handle 是受管文件 source，不是 `Uint8Array`、宿主绝对路径或隐式挂载。

## afterAgent 是不可逆边界

```typescript
interface TestContext<C extends EvalCriteria> extends AssertionContext {
  send(...args: SendArgs): Promise<Turn>;
  afterAgent(run: (after: AfterAgentContext<C>) => Promise<void> | void): Promise<void>;
}

interface AfterAgentContext<C extends EvalCriteria> extends AssertionContext {
  readonly sandbox: SandboxHandle;
  readonly criteria: CriteriaHandles<C>;
}
```

第一次调用 `t.afterAgent(...)` 时，Runner 等待未完成 turn，永久关闭本 Attempt 的 Agent 驱动面，并冻结 agent diff。
callback context 不提供 `send`、`newSession` 或任何重新驱动 Agent 的入口；callback 返回后也不能再调用 `t.send()`。

一条 Eval 最多调用一次 `afterAgent`。
重复调用或边界后的 Agent 操作是配置/运行错误，不通过“当前是否恰好有 turn”猜测作者意图。

callback 内仍使用普通能力:

```typescript
await t.afterAgent(async (after) => {
  await after.sandbox.uploadDirectory(after.criteria.tests, "/tests");
  await after.sandbox.uploadFile("/tests/run-tests.sh", after.criteria.runTests);
  const result = await after.sandbox.runShell("bash /tests/run-tests.sh", { root: true });
  after.check(result, commandSucceeded());
});
```

criteria handle 作为普通 `uploadFile` / `uploadDirectory` 的 source 参数。
Runner 记录由 handle 发起的上传并在 callback 结束后清理其受管目标；脚本额外产生的文件属于 after-Agent 归因，并由 Attempt reset/teardown 屏障处理。

callback 抛错或超时属于 `eval.afterAgent` phase。
断言仍按正常 verdict 规则折叠；清理失败追加 diagnostic，并禁止复用该 Sandbox。

## Private files

`privateFiles` 用于永不上传但必须进入判据指纹和泄题门的 solution、生成器或参考答案。
它与 `criteria` 共址时，泄题门仍检查全部 build context 与 Agent 可达 bind mount。

## Environment 与 setup

```typescript
type EvalEnvironment = string | SandboxSource;
```

字符串是 environment profile，`SandboxSource` 是 provider-neutral 的 folder-local 输入。
SandboxSpec 按 `environments[profile]`、匹配 materializer、无 Environment 时的默认 case 顺序解析唯一 Sandbox Case。

SandboxSpec setup 作用于最终主 Sandbox，EvalDef setup 准备当前题目，Agent setup 安装 Agent CLI。
三个 owner 按固定顺序执行，不合并为通用 Requirement 图。

## 顶层登记 loader 退出

`loadCriteria()` 与 `loadPrivate()` 从公共 API 删除。
旧 Eval 一次性把路径移入当前 EvalDef 的 `criteria` / `privateFiles`；不保留模块级登记表，也不让新字段经兼容 loader 间接实现。

`loadText` / `loadYaml` / `loadJson` 仍是普通数据 loader：它们把内容读进定义值，不承担隐藏文件身份登记。
