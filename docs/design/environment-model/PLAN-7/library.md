# PLAN-7 —— Library 候选形状

**相关文档**:[方案](README.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## EvalDef

```typescript
interface EvalDef {
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly timeoutMs?: number;
  readonly environment?: string | SandboxSource;
  readonly fixture?: EvalFixture;
  readonly verifier?: EvalVerifier;

  setup?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  teardown?(sandbox: Sandbox, ctx: EvalSetupContext): Promise<void> | void;
  test(t: TestContext): Promise<void> | void;
}
```

`test(t)` 负责驱动 Agent 与读取 Agent 结果。
静态文件的可见时机不靠 `test(t)` 内的上传顺序表达，而由 `fixture` 或 `verifier` 字段声明。

## 受管文件

```typescript
type EvalFileSource =
  | string
  | URL
  | {
      readonly root: string | URL;
      readonly ignore?: readonly string[];
    };

interface EvalFileMount {
  readonly from: EvalFileSource;
  readonly to: string;
}
```

`from` 指向一个普通文件或目录。
目录按稳定路径顺序递归展开，`ignore` 使用项目统一 glob 语义。

字符串从项目根解析，URL 从声明它的 Eval 模块解析。
`to` 是 Sandbox 内的绝对路径；目录 source 把目录内容放到该路径，文件 source 写到该文件路径。

发现期要求每个 source 存在、留在项目根内，且不能经符号链接逃出项目根。
文件内容、相对路径与类型进入对应身份；mtime 不进入身份。

## 可见 Fixture

```typescript
interface EvalFixture {
  readonly files: readonly EvalFileMount[];
}
```

Runner 在 EvalDef setup 后、Agent setup 前上传 `fixture.files`。
这些文件是 Agent 应看到的题目起始材料，进入 Eval 数据指纹并记为 eval 归因。

动态准备继续写在 `setup`。
例如 checkout、创建外部临时 repo 或根据运行时凭据生成配置，不伪装成静态文件声明。

## 隐藏 verifier

```typescript
interface EvalVerifier {
  readonly files?: readonly EvalFileMount[];
  verify(v: VerifyContext): Promise<void> | void;
}
```

`verifier.files` 在发现期进入判据指纹和泄题门，在最后一次 Agent turn 结束后才上传。
Runner 上传成功后调用 `verify(v)`，结束后删除这些文件。

`VerifyContext` 提供断言、反馈与受限 Sandbox 操作，但不提供 `send`、`newSession` 或任何重新驱动 Agent 的入口:

```typescript
interface VerifyContext {
  readonly sandbox: SandboxHandle;
  check<T>(actual: T, matcher: Matcher<T>): AssertionHandle;
  require<T>(actual: T, matcher: Matcher<T>): Promise<void>;
  progress(update: ProgressUpdate): void;
  diagnostic(diagnostic: Diagnostic): void;
}
```

`verify` 抛错或超时属于 `eval.verify` phase。
断言仍按正常 verdict 规则折叠；清理失败只追加 diagnostic，不覆盖已经得到的判定。

## Environment 与 setup

```typescript
type EvalEnvironment = string | SandboxSource;
```

字符串是 environment profile，`SandboxSource` 是 provider-neutral 的 folder-local 输入。
SandboxSpec 按 `environments[profile]`、匹配 materializer、无 Environment 时的默认 case 顺序解析唯一 Sandbox Case。

SandboxSpec setup 作用于最终主 Sandbox，EvalDef setup 准备当前题目，Agent setup 安装 Agent CLI。
三个 owner 按固定顺序执行，不合并为通用 Requirement 图。

## 顶层 loader 的迁移位置

`loadCriteria()` 与 `loadPrivate()` 可以继续读取旧 Eval；正常作者路径使用 EvalDef 内的文件字段。
新 Eval 使用 `verifier.files`；永不上传但要进入泄题门的参考答案使用 EvalDef 的 `privateFiles`:

```typescript
interface EvalDef {
  readonly privateFiles?: readonly EvalFileSource[];
}
```

`privateFiles` 只参与判据指纹与泄题门，Runner 在任何相位都不上传它们。
它与 `verifier.files` 共址时，泄题门仍检查全部 build context 与 Agent 可达 bind mount。
