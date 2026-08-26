# 方案 1：场景元数据与媒介语义 Matcher

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [DECISION](../DECISION.md)

## 解决的问题

本方案做最小演进。
它保留现有测试位置、Feature 测试文档和 unit / E2E 两层执行，只给用户行为增加稳定身份，并替换容易漂移的媒介断言。

它不增加第三个测试层，不把机制测试改写成用户故事，也不建立跨媒介的统一验收模型。

## 核心规则

- 只有主证明声明 Behavior；边界与 supporting proof 只引用它。
- 每个 Behavior 恰有一个 `primary` proof，可以有零个或多个 `supporting` proof。
- 普通机制测试继续使用 `it`、`it.effect` 与局部 fixture，不强制关联 Behavior。
- Behavior 只引用 Feature 契约，不复制契约正文。
- JSON、JUnit、HTML、浏览器、plain stdout 与 PTY 使用各自的 matcher。
- 结构化输出先 parse 再比较语义；golden 只用于明确逐字承诺的短文本。
- 真实 SDK、CLI、package consumer 与浏览器边界仍由真实 E2E 证明。

## 调用面

```typescript
type ObservableSurface =
  | "library"
  | "cli"
  | "stdout"
  | "terminal-pty"
  | "json"
  | "junit"
  | "html"
  | "browser"
  | "real-protocol";

interface BehaviorMeta {
  id: string;
  contract: string;
  surfaces: readonly [ObservableSurface, ...ObservableSurface[]];
  requiredBoundaryProofs: readonly {
    id: string;
    repository: string;
    surfaces: readonly [ObservableSurface, ...ObservableSurface[]];
  }[];
  bug?: string;
}

interface ProofMeta {
  id: string;
  behaviorId: string;
  behaviorRepository?: string;
  surfaces: readonly [
    ObservableSurface | "mechanism",
    ...(ObservableSurface | "mechanism")[],
  ];
  requirementId?: string;
}

behavior(meta).it(title, testBody);
supportingProof(meta).it(title, testBody);
boundaryProof(meta).it(title, testBody);
behavior(meta).title(title);
supportingProof(meta).title(title);
```

`behavior()` 只注册身份并补充诊断上下文。
它不隐藏 fixture、clock、Layer、浏览器、模型调用或断言。
Effect 测试把 `.title()` 交给原生 `it.effect` / `it.scoped`，不由 Registry wrapper 重造 runner API。

```typescript
behavior({
  id: "reports.filter.by-experiment",
  contract: "docs/feature/insight/use-case/制作可访问页面.md#制作可访问页面",
  surfaces: ["browser"],
  requiredBoundaryProofs: [],
}).it("用户收窄到 main 后只看到 main 的实验", async () => {
  const page = await openView({ experiments: ["main"] });

  await expect(page.getByRole("table", { name: "实验比较" }))
    .toShowRowsExactly([{ experiment: "main" }]);
});
```

Effect 机制证明可以选择挂到同一个 Behavior，但仍使用受控机制词汇：

```typescript
const singleFlight = supportingProof({
  id: "runner.cache.single-flight",
  behaviorId: "runner.cache.reuse-expired",
  surfaces: ["mechanism"],
});

it.effect(
  singleFlight.title("同一缓存身份的并发读取只启动一次"),
  () =>
    Effect.gen(function* () {
      // TestClock、barrier 与带身份的事件序列仍在正文中。
    }),
);
```

没有用户行为后果的算法、错误传播和数据结构测试继续写普通 `it`。

## 媒介 Matcher

Matcher 按媒介分开，不建立一个万能 `term()` 或结构树：

```typescript
expect(stdout).toShowPlainReport({
  experiments: ["main"],
});

expect(ptyScreen).toShowTerminalTable({
  rows: [{ experiment: "main", status: "pass" }],
});

expect(jsonText).toMatchReportJson({
  attempts: [{ id: attemptId, experiment: "main" }],
});

expect(junitText).toReportJUnitFailure({
  caseId,
  message: /timeout/,
});

await expect(page.getByRole("dialog", { name: attemptId }))
  .toDescribeAttempt({ id: attemptId, tool: "search" });
```

每个 matcher 都要求足以区分目标对象的身份。
`count === 1`、任意文本存在或任意 dialog 可见，不能单独证明标题声称的结果。

## Registry

Registry 从测试里的静态元数据派生，不签入第二份场景清单。
守护至少验证：

- 每个 `repository + Behavior ID` 只有一份声明；
- Proof ID 在所属仓库唯一；
- 契约链接存在；
- 每个 Behavior 恰有一个 `primary` proof；
- 声明要求的每个边界 proof 都存在；
- surface 与 bug 引用合法；
- 元数据是可静态读取的字面量；
- 同一测试不能同时充当两个行为的主证明。

生成的只读索引展示：

```text
Behavior → Feature 契约 → primary proof → supporting proofs → surface
```

现有 `// cases:` 可以在迁移期继续登记机制守护文档。
当某个 Feature 的用户行为都进入 Registry 后，再删除对应 Markdown 场景清单。

## 执行命令

根仓 unit 与机制证明仍由 `pnpm test` 执行。
自治 E2E 仓库的最终入口仍是：

```bash
pnpm e2e
```

一次运行完成 prepare、打印 frozen world manifest，再执行全部验收。
本地单例重跑使用同一入口：

```bash
pnpm e2e -- --reuse <manifest> --behavior reports.filter.by-experiment
```

`--reuse` 校验 candidate、producer / driver、外部依赖、运行条件与 prepare 配置 identity。
Manifest 不匹配、未冻结或缺少 artifact 时直接失败，不静默重新调用模型。

## 错误语义

| 失败 | 反馈 |
|---|---|
| 重复 ID、失效契约链接、缺少主证明 | 在 docs guard 阶段失败，列出全部冲突位置 |
| evidence 无法读取 | 报告媒介、读取阶段、原始 evidence 路径和最小读取错误 |
| 用户结果不匹配 | 报告 Behavior ID、目标身份、期望、实际候选和最小差异 |
| E2E 准备失败 | 标成 prepare 失败，不伪装成 assertion mismatch |
| matcher 试图修改冻结 evidence | 立即失败，并报告 world 与写入路径 |

Matcher 不得在断言阶段重新调用模型、追加 Record 或依赖上一条测试的副作用。

## 迁移方式

1. 先实现 Registry 守护和少量媒介 matcher。
2. 选择 Report browser、machine export 与 Runner cache 三组行为试点。
3. 后续修改用户行为时，为它补齐或指定主证明。
4. 原始字符串、CSS class、框线和整文件 golden 只在触达时替换。
5. 多个场景开始重复同一用户任务编排时，再升级作者面。

## 代价

- 行为证明仍散落在现有目录；Registry 改善导航，却没有形成连续的用户任务规格。
- 元数据能验证连接关系，不能理解标题中每一个自然语言主张。
- 媒介 matcher 容易逐渐长成 renderer 的影子实现。
- 同一行为跨多个媒介时，动作和期望仍要分别书写。
- 旧 E2E 的共享可变 evidence 与顺序依赖仍要另外重构。

这个方案适合快速降低脆弱断言和补齐追踪。
它不能单独解决测试正文长期被 fixture、parser 与媒介结构占据的问题。
