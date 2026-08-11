# 源码证据与调用树

源码视图把每条 AssertionResult 回映到评估源码。它依赖三类事实：Assertion 调用位置、从入口到该位置的运行时帧路径，以及首次引用时保存的项目文件正文。

## 位置与帧路径

`SourceLoc` 的 `file`、`line` 和 `column` 表示声明位置。`callers` 保存从 eval 入口到该位置的路径：

```ts
interface ProjectSourceFrame {
  kind: "project";
  file: string;
  line: number;
  column?: number;
}

interface PackageSourceFrame {
  kind: "package";
  package: string;
}

interface SourceLoc {
  file: string;
  line: number;
  column?: number;
  callers: (ProjectSourceFrame | PackageSourceFrame)[];
}
```

`AssertionResult.callsite` 标记登记 Assertion 的位置；`policyLocations` 标记 `.atLeast()`、`.score()`、`.orStop()` 等 policy 的配置位置。用户消息事件使用同一种位置形状。

每个 attempt 共享单调 `sourceOrder`。send 与 Assertion 按真实发生顺序拿到该序号；同一 Assertion 的 policy locations 留在同一 entry，装配层不从不同数组的存储顺序猜时间关系。

## 源码快照

每个 attempt 有一个 `SourceRegistry`。入口文件在 discovery 时登记；首次捕获到某个项目文件时读取、规范化并缓存正文。后续位置只复用缓存，因此正文与首次引用它的 Assertion 属于同一运行时刻。

读取失败不改变 Assertion evaluation。注册表保留不可用状态，展示层显示源码缺口；同一失败文件在一个 attempt 内不会重复读取。

## 完整树

`AnnotatedEvalSource` 是展示无关的完整证据。它保留所有成功捕获的源码行和注解：

```ts
interface AnnotatedEvalSource {
  spine: SourceNode;
  detached: SourceNode[];
  unmapped: {
    assertionResults: AssertionResult[];
  };
  summary: AnnotatedEvalSourceSummary;
}

interface SourceCallSummary {
  assertions: number;
  matched: number;
  mismatched: number;
  unavailable: number;
  scoreContribution?: number;
  stopped: boolean;
}
```

AssertionResult 与 send 头行都可以成为 `LineAnnotation`。当前 `result.json` 条目按 `sourceOrder` 排列；schema 18 以前的 Run 文件整份不支持读取，因此没有旧 Fact/use 回退分支。

## 装配边界

`loadAttemptEvidence()` 解引用源码并调用 `assembleSourceTree()`。它接收 `assertionResults`、send 注解和可选 stop 位置，产出完整树；展示层再按自己的预算投影。

这样 `niceeval show --source`、默认详情和网页共用同一套 Assertion 源码证据，而不各自解释 Judge、condition 或 score contribution。
