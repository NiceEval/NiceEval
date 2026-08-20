# 工作目录访问证据 —— Library

完整的执行和证据边界见 [Architecture](architecture.md)。本页定义作者可导入或写入 Eval 的唯一公开形状。

## Eval 声明

Sandbox Eval 以 workspaceAccess 预声明工作目录访问证据的 collection 要求。省略字段表示不请求该证据，因而不能登记访问 Assertion。

```ts
type WorkspaceAccessCollectionMode = "required" | "best-effort";

interface WorkspaceAccessRequirement {
  readonly collection: WorkspaceAccessCollectionMode;
}

interface EvalInput {
  readonly workspaceAccess?: WorkspaceAccessRequirement;
}

export default defineEval({
  workspaceAccess: { collection: "required" },
  async test(t) {
    await t.send("读取 src/config.ts，再完成任务。");
    t.sandbox.accessedWorkspace({
      actions: ["read"],
      path: { kind: "exact", path: "src/config.ts" },
    }).label("读取配置");
  },
});
```

required 表示完整 collection 是本 Attempt 的执行前提。best-effort 保留已知证据，并由各 Assertion 按三值规则结算。

Direct Agent 没有 Agent Sandbox namespace。它与 workspaceAccess 的组合在 link 阶段以 `workspace-access.unexpected-for-direct-agent` 失败，零资源创建。

Provider 对 required 不支持工作目录访问 collection 时，也在 link 阶段以 `sandbox.workspace-access-unsupported` 失败，零 Agent、collector 或 Sandbox 启动。best-effort 可在不支持的 Provider 上运行；其封口 evidence 的 unavailable reason 为 `provider-unsupported`。

## 路径、动作与操作

工作目录路径不是宿主路径，也不是 Agent 输出的文本。WorkspaceRelativePath 是工作目录相对的 POSIX 路径：不能为空，不能含 `.`、`..`、反斜线或控制字符。

```ts
type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

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

type WorkspacePathSelector =
  | {
      readonly kind: "exact";
      readonly path: WorkspaceRelativePath;
    }
  | {
      readonly kind: "subtree";
      readonly path: WorkspaceRelativePath;
    };

type WorkspaceRenameEndpointMatch =
  | {
      readonly endpoint: "from";
      readonly from: WorkspacePathSelector;
    }
  | {
      readonly endpoint: "to";
      readonly to: WorkspacePathSelector;
    }
  | {
      readonly endpoint: "both";
      readonly from: WorkspacePathSelector;
      readonly to: WorkspacePathSelector;
    };

type WorkspaceAccessMatch =
  | {
      readonly actions: NonEmptyReadonlyArray<
        Exclude<WorkspaceAccessAction, "rename">
      >;
      readonly path: WorkspacePathSelector;
      readonly outcomes?: NonEmptyReadonlyArray<WorkspaceAccessOutcome>;
    }
  | ({
      readonly actions: readonly ["rename"];
      readonly outcomes?: NonEmptyReadonlyArray<WorkspaceAccessOutcome>;
    } & WorkspaceRenameEndpointMatch);

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
```

exact 只匹配一个规范化路径；subtree 匹配该目录与全部后代。actions 和给出的 outcomes 均非空、无重复。
rename 只能用单元素 `["rename"]`，且必须通过封闭的 `endpoint` union 选择 from、to 或 both，不能零端点。
from 分支只判断原路径端，to 分支只判断目标端，both 分支要求同一 operation 的两端分别命中各自 selector。

read 只表示读取文件内容；write 只表示修改既有内容；create 表示建立新目录项；delete 表示移除目录项；rename 表示同一原子移动的两个端点；execute 表示以该路径作为可执行目标；list 表示枚举目录项；metadata 表示读取或改变不属于内容读写的文件属性。list 与 metadata 不折叠为 read，八种动作也不互相推导。

operationId 是 Attempt-local、非空且唯一的操作身份。它不泄露 syscall 参数、宿主 inode 或 private namespace；同一 rename 的 from/to 只存在于同一个 rename operation 中。

## 封口 evidence

```ts
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
      readonly limitations: NonEmptyReadonlyArray<
        WorkspaceAccessPartialLimitation
      >;
    }
  | {
      readonly state: "unavailable";
      readonly reason: WorkspaceAccessUnavailableReason;
    };
```

limitations 与 reason 都是封闭 code union，没有任意 string、provider 原文或自由文本 reason。path-unresolved 表示某操作未能安全映射为 WorkspaceRelativePath；attribution-uncertain 表示不能可靠归属至当前 Agent 进程树。

stream-lost、stream-truncated、collector-capacity-exhausted 与 producer-interrupted 分别说明已知 evidence 不再完整。开始前失败、第一项操作前失去 stream 或 producer 被中断才使用 unavailable 的对应 reason。

## post-run Assertion

```ts
interface EvalSandbox {
  accessedWorkspace(
    match: WorkspaceAccessMatch,
  ): PostRunBooleanAssertionHandle;

  didNotAccessWorkspace(
    match: WorkspaceAccessMatch,
  ): PostRunBooleanAssertionHandle;
}
```

两次调用都立即登记同一类 Assertions entry。它们返回既有的 PostRunBooleanAssertionHandle，只可配置 key、label、group 与 optional；不能作为 value，不能调用 orStop，也没有通用的访问日志 subject。

```ts
export default defineEval({
  workspaceAccess: { collection: "best-effort" },
  async test(t) {
    await t.send("只编辑 src/。");

    t.sandbox.accessedWorkspace({
      actions: ["write", "create"],
      path: { kind: "subtree", path: "src" },
      outcomes: ["succeeded"],
    }).label("写入实现");

    t.sandbox.didNotAccessWorkspace({
      actions: ["rename"],
      endpoint: "to",
      to: { kind: "subtree", path: "secrets" },
    }).optional().label("没有把内容移入秘密目录");

    t.sandbox.accessedWorkspace({
      actions: ["rename"],
      endpoint: "both",
      from: { kind: "subtree", path: "src" },
      to: { kind: "subtree", path: "archive" },
    }).label("把源码移入归档目录");
  },
});
```

accessedWorkspace 在至少一个已知 operation 完整命中所选端点时 matched。complete 且没有命中时 mismatched。
partial 或 unavailable 在没有正向 witness 时 unavailable。

didNotAccessWorkspace 在一个已知 operation 命中时 mismatched。complete 且没有命中时 matched。partial 或 unavailable 在没有反向 witness 时 unavailable。

optional 只决定这条 unavailable Assertion 是否参与既有 Verdict 规则。它不改变 matcher 的三值结果，也不能降低 required collection 的执行要求。

## required 与 Assertion 严重度

required 的任何 partial 或 unavailable 都直接把 Attempt 结算为 errored。Runner 仍保存已经取得的有限诊断，但正向 witness 不能证明完整性，也不能挽救 Attempt。

只有 best-effort 进入上一节的三值 matcher。一个 required 或 optional Assertion 都可以读取这份三值结果；Assertion severity 与 evidence completeness 始终是两条独立轴。

## JSON 文本路径 Match

路径文字检查继续属于 niceeval/expect 的纯 Match，而不是访问 Assertion。

```ts
import { jsonMentionsAnyPath } from "niceeval/expect";

declare function jsonMentionsAnyPath(
  paths: readonly [string, ...string[]],
): BooleanMatch<JsonValue, JsonValue, "value">;
```

jsonMentionsAnyPath 只递归读取 JSON array 与 plain object 的 string leaf。它按路径分量边界寻找文本 witness，并在诊断中给出 JSON Pointer。输入路径去除空分量与 `.` 后比较；归一化后重复的输入被拒绝。

它不解释 shell、不会跟随 symlink、不会检查真实文件系统，也不会把一个字符串命中解释成 Agent 访问。referencesAnyPath 没有导出、别名或兼容入口；所有 JSON 文本场景只使用 jsonMentionsAnyPath。

## 生产入口验收

1. niceeval check 必须在资源创建前拒绝缺少 workspaceAccess 的访问 Assertion、非法 selector，以及 required Provider 不支持；后者报 `sandbox.workspace-access-unsupported` 且零 Agent。
2. niceeval exp 的 required Eval 在 partial、unavailable 与路径逃逸时都形成 errored Attempt，哪怕已有正向 witness。
3. niceeval exp 的 best-effort Eval 必须分别验证正向 witness、完整负证据与不完整 unavailable。
4. niceeval show 与 JSON 输出必须只读取 sealed Attempt evidence，不重新读取活 Sandbox。
