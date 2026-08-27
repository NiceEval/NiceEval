# 工作目录访问证据 —— CLI

本方向不新增 CLI 命令或 flag。访问证据通过既有的 `niceeval check`、`niceeval exp`、`niceeval exp --dry`、机器 `niceeval query` 与人用 `niceeval view` 呈现。

## 人类输出

dry 计划为声明了 workspaceAccess 的 Eval 显示 collection 要求与结算时点：

```text
EVIDENCE
  workspace access  required · agent workspace · post-run
```

运行结束后，Attempt 摘要把 evidence collection 状态与 Assertion result 分开显示：

```text
WORKSPACE ACCESS  partial · best-effort
  ✓ 写入实现                 write/create subtree src
  ? 没有读取秘密目录          evidence incomplete
```

required 的不完整 evidence 显示为执行错误，而不是普通 Assertion mismatch：

```text
error: Required workspace access evidence is incomplete because collection ended early.
details: niceeval view --run <run-id>
```

View 页面再从 Run/Attempt 导航选择该 locator 对应的 Attempt。

required Provider 不支持时，link 在任何 Agent 启动前失败：

```text
error: This Sandbox Provider cannot collect the required workspace access evidence.
```

路径只以工作目录相对、symlink 后的规范形式显示。人类输出不显示宿主绝对路径、cache 位置、private asset 名称或原始 syscall 参数。

## JSON

dry 的计划文档在对应 Eval 上增加下列只读字段：

```ts
interface WorkspaceAccessPlan {
  readonly collection: "required" | "best-effort";
  readonly scope: "agent-workspace";
  readonly phase: "post-run";
}
```

运行 JSON 的 action、operation、limitation 与 unavailable reason 与 [Library](library.md) 使用同一公开形状：

```ts
type WorkspaceRelativePath = string;
type WorkspaceAccessOperationId = string;

type WorkspaceAccessAction =
  | "read"
  | "write"
  | "create"
  | "delete"
  | "rename"
  | "execute"
  | "list"
  | "metadata";

type WorkspaceAccessOutcome =
  | "succeeded"
  | "denied"
  | "failed";

type WorkspaceAccessOperation =
  | {
      readonly operationId: WorkspaceAccessOperationId;
      readonly action: Exclude<WorkspaceAccessAction, "rename">;
      readonly outcome: WorkspaceAccessOutcome;
      readonly path: WorkspaceRelativePath;
    }
  | {
      readonly operationId: WorkspaceAccessOperationId;
      readonly action: "rename";
      readonly outcome: WorkspaceAccessOutcome;
      readonly from: WorkspaceRelativePath;
      readonly to: WorkspaceRelativePath;
    };

type WorkspaceAccessPartialLimitation =
  | "path-unresolved"
  | "attribution-uncertain"
  | "stream-lost"
  | "stream-truncated"
  | "collector-capacity-exhausted"
  | "producer-interrupted";

type WorkspaceAccessUnavailableReason =
  | "provider-unsupported"
  | "collector-start-failed"
  | "stream-lost-before-first-operation"
  | "producer-interrupted-before-first-operation";

type WorkspaceAccessCollection =
  | {
      readonly state: "complete";
      readonly operations: readonly WorkspaceAccessOperation[];
    }
  | {
      readonly state: "partial";
      readonly operations: readonly WorkspaceAccessOperation[];
      readonly limitations: readonly [
        WorkspaceAccessPartialLimitation,
        ...WorkspaceAccessPartialLimitation[],
      ];
    }
  | {
      readonly state: "unavailable";
      readonly reason: WorkspaceAccessUnavailableReason;
    };

interface WorkspaceAccessAssertionEvidence {
  readonly collection: WorkspaceAccessCollection;
  readonly witness?: WorkspaceAccessOperation;
}
```

JSON 不包含完整访问流、原始 namespace 路径、未命中的普通文件名、private asset、credential 或 collector 内部实现信息。它也不添加自由文本 limitations 或 reason。

## exit code 与 dry 边界

| 情况 | exit code | 资源边界 |
| --- | --- | --- |
| 合法的 check 或 dry 计划 | 0 | 不创建 Sandbox、Agent 或 collector |
| 缺少 collection 声明、Direct Agent 组合、非法 selector，或 required Provider 不支持 | 2 | link 前终止；Provider 不支持报 `sandbox.workspace-access-unsupported`，零 Agent |
| required collection 为 partial、unavailable 或发生 path escape | 1 | Attempt errored，按既有收尾链回收 |
| best-effort Assertion unavailable | 沿既有 Assertion / Verdict 规则 | 不产生专用退出码 |

dry 展示静态 collection 要求，并对 required 核对已声明 Provider capability；它不启动 collector、不读取 live Sandbox，也不把“计划可展示”描述成“完整 evidence 已取得”。
正式 `niceeval exp` 继承 [CLI 的统一退出码](../../cli.md#退出码)：上述受控执行错误为 `1`，未捕获崩溃为 `2`，中断为 `130`；本方向不新增 access 专用状态码。

## 并发与审计

每个 dispatched Attempt 取得独立 collector、根 capability 与 evidence 上限。复用 Sandbox 时，相邻 Attempt 的 collector 不共享 operation buffer、completeness、witness 或错误状态。

并发不会改变同一 Attempt 内 operation 的因果顺序。不同 Attempt 的 operation 不建立全局顺序，也不会被 CLI 合并成一个访问流。

`niceeval query` 与 `niceeval view` 是固定的事后读取入口。它们读取已封口的 Assertion evidence，不附着活进程、不扫描留存 Sandbox，也不从现有工作树补采 evidence。
