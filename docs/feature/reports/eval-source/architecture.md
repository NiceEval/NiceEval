# 源码证据与调用树

源码调用树依赖三类事实：每条痕迹的声明位置、从入口到声明处的运行时帧路径，以及这些项目文件在首次被引用时的正文。
采集属于 core，不按 Adapter 或 Sandbox 分支。

## 位置与帧路径

`SourceLoc` 的 `file`、`line` 和 `column` 仍表示声明位置。
`callers` 保存从外到内的调用路径，不含声明位置自身：

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

type SourcePathFrame = ProjectSourceFrame | PackageSourceFrame;

interface SourceLoc {
  /** 相对项目根的声明位置。 */
  file: string;
  line: number;
  column?: number;
  /** 从 eval 入口到声明处，由外到内；无可用链时为空数组。 */
  callers: SourcePathFrame[];
}
```

项目帧必须位于 config 所在的项目根内。
niceeval 自身、Node 内建模块和 loader 过渡帧不进入路径；连续的同一个第三方包帧折叠成一个 `PackageSourceFrame`。
链上项目文件不存在或不可读时仍保留 `ProjectSourceFrame`，让展示层标出缺口。

声明位置自身必须是项目帧。
断言直接声明在第三方包内部时没有可映射的项目源码位置，因此 `loc` 省略并进入 unmapped；package frame 只表达两个项目帧之间的不可展开路径，例如包调用项目回调。

`AssertionResult.loc`、`ScoreEntry.loc` 与用户消息事件的 `loc` 共用这个形状。
完整项目帧序列是 `callers` 中的 project 分支加声明位置，package 分支保留它们之间不可展开的边界。

### 采集约束

一次 `captureLoc()` 物化一份栈并完成下面的同步步骤：

1. 把 `Error.stackTraceLimit` 临时提高到 64，采集结束立即还原。
2. 解析全部帧，规范化 URL、绝对路径与路径分隔符。
3. 丢弃 niceeval、Node 与 loader 帧，保留项目帧并折叠第三方包段。
4. 从内到外的 V8 栈反转成 `callers` 要求的外到内顺序。

这段操作没有 `await`，临时全局值不会跨事件循环让给其它 attempt。
超过 64 帧或跨 async 边界丢失的前缀不猜测；已有帧照常落盘，展示层按不完整链降级。

项目根由 attempt 显式注入，不从 `process.cwd()` 猜。
项目路径经过真实路径规范化并确认仍在项目根内，才允许进入源码读取注册表。

## 源码快照

每个 attempt 有一个 `SourceRegistry`。
入口文件在 discovery 时捕获并登记为 `entry`；每次 `captureLoc()` 首次遇到新的项目文件时，注册表同步读取、规范化并缓存正文。
后续痕迹只复用缓存。
因此正文与引用该文件的第一条判定属于同一运行时刻，不会在 attempt 收尾时读到后来改过的文件。

读取失败不影响判定，也不删除帧。
注册表保存不可用状态，展示层据此输出 `source unavailable: <path>`。
同一失败文件在一个 attempt 内不重复读取。

[`sources.json`](../../record/architecture.md#sourcesjson) 只保存成功捕获的正文和入口角色；不可用帧已经随 `loc.callers` 落在 `result.json` 或事件里，不制造没有正文的哈希引用。

## 完整树

`AnnotatedEvalSource` 是面无关的完整证据。
所有成功捕获的节点都保留整份源码行，不在这里应用终端预算、上下文半径或默认展开规则：

```ts
interface AnnotatedEvalSource {
  spine: SourceNode;
  detached: SourceNode[];
  unmapped: {
    assertions: AssertionResult[];
    scores: ScoreEntry[];
  };
  summary: AnnotatedEvalSourceSummary;
}

interface SourceNode {
  file: string;
  sha256: string;
  lines: SourceLine[];
}

interface SourceLine {
  line: number;
  text: string;
  annotations: LineAnnotation[];
  calls: SourceCall[];
  aborted?: true;
}

interface SourceCall {
  summary: SourceCallSummary;
  target:
    | { kind: "source"; node: SourceNode }
    | { kind: "package"; package: string; calls: SourceCall[] }
    | { kind: "unavailable"; file: string; calls: SourceCall[] };
}

interface SourceCallSummary {
  checks: number;
  passed: number;
  failed: number;
  unavailable: number;
  points?: { earned: number; available: number };
  aborted: boolean;
}
```

`LineAnnotation` 是断言、给分记录和 send 头行事实的判别联合，数组按实际发生顺序排列。
`SourceCallSummary` 自底向上汇总后代标注。
它不含调用次数：调用帧没有 invocation 身份，无法区分“调用三次各产生两条断言”和“调用一次产生六条断言”。

同一调用行到同一目标段的路径合并为一条 `SourceCall`。
循环产生的标注按发生顺序累加；一行调用两个不同文件或经过两个不同 package 段时保留两条边。
递归调用按本次有限栈中的路径建有限节点，不把节点做成自引用对象。

## 装配边界

`loadAttemptEvidence()` 解引用源码并调用 `assembleSourceTree()`，产出完整树。
装配函数没有展示选项：

```ts
assembleSourceTree(input: {
  entry: SourceArtifact;
  sources: SourceArtifact[];
  assertions: AssertionResult[];
  scoreEntries: ScoreEntry[];
  sends: SendAnnotation[];
  abort?: SourceLoc;
}): AnnotatedEvalSource
```

`SourceArtifact` 带 `role`，因此入口不靠断言命中数猜测。
没有任何源码时 `evalSource` 为 `null`；入口存在但其它源码都不可用时仍产出只有主干和缺口的树。

展示层再调用 [`projectSourceView()`](display.md#投影)，得到某个消费面的 `SourceContent`。
这样同一份 `AttemptEvidence` 可以同时服务默认终端、`--source=full`、单文件模式和 web。
