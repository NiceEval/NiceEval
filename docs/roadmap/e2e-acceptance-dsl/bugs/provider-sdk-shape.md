# Bug 组：第三方 SDK 形状不能由测试自己发明

这一组用 E2B provisioning reconcile 作正例，用 detached inspect 的同形复发作反证。
它同时给出一条否定结论：普通用户侧 DSL 不能确定性捕获所有 provider 缺陷。

## 正例：reconcile 把 paginator 当数组

fix commit `0cef7946` 前，`reconcileProvision()` 用 `as unknown as` 手写 `Sandbox.list()` 返回 `Promise<Array>`。
E2B 从受支持下限 `2.0.0` 起实际一直同步返回 `SandboxPaginator`，需要循环 `hasNext` 并等待 `nextItems()`。

真实运行先遇到可重试的创建故障，进入对账后抛 `TypeError: sandboxes is not iterable`，于是原本可恢复的整批运行被中止。
公开错误事实是 NiceEval 的重试路径自身崩溃，并把用户从原始 provider 故障引向无关的 JavaScript 类型错误。

fix 前 `retry.test.ts` 把 reconcile 当任意 async callback，只证明调用顺序与失败策略。
仓库没有 `reconcileProvision` 测试；错误实现又用双重类型断言绕过真实 SDK 声明，所以 typecheck 和 unit 全绿。
fix commit 本身也没有新增回归测试，直到后续 `285990d7` 才加入 paginator mock 与 reconcile cases。

## 同形反证：detached inspect 再次猜错同一 API

commit `4b37775` 修复 `src/sandbox/keep.ts` 中相同的 `Promise<Array>` 假设。
更关键的证据是 fix 前 `keep.test.ts` 也写了 `e2bListMock.mockResolvedValue([...])`：测试与产品共享同一条虚构 API，因此测试稳定地为错误事实背书。

这个反证排除了「给 reconcile 补一个 bug 专用测试」的方案。
最少守护必须覆盖所有 E2B `Sandbox.list()` 调用点，或者让生产代码直接保持真实返回类型，使错误形状无法编译。

## 最早失败层

这类错误最早应在 compile 或 provider unit contract 失败，不应等待用户侧 E2E。

```ts
providerContract("e2b list traversal", () => {
  const paginator = Sandbox.list({ query: { metadata: { token: "x" } } });
  expectTypeOf(paginator).toMatchTypeOf<SandboxPaginator>();
  return traversesEveryPage(paginator);
});
```

实际守护不应复制上面的 `SandboxPaginator` 手写形状，而要直接引用 `ReturnType<typeof Sandbox.list>`。
mock 只实现从真实类型推导出的 interface，并至少提供两页，避免单页假实现掩盖循环错误。

用户侧能证明的只有语义结果，例如 `niceeval sandbox list` 把凭据或网络故障显示为 unknown，而不是 expired。
它不能稳定制造「create 已可能成功但客户端收到歧义错误」的远端窗口。
若没有 provider fault proxy 或官方 emulator，这一条应明确标为机制缺口。

## DSL 如何定位已发生的故障

当真实 provider 运行自然撞到故障时，`cli()` 仍应把它定位到 invoke，并保留完整诊断，而不是让后续 Report 查询报对象缺失。

```ts
sandboxBehavior(retryDoesNotFailInsideReconcile, async () => {
  const run = await cli("pnpm exec niceeval exp e2b-smoke --force", { expect: 0 });
  expectObserved(run.diagnostics().codes()).toShowExactRows([]);
});
```

这段不是确定性 PR 回归方案，因为没有控制故障前置条件。
账本因此不把它算作已捕获；需要的机制是 provider fault scenario，能声明 create 的歧义失败、远端遗留实例与随后 list 的分页响应。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 类型守护引用安装中的真实 SDK 声明；provider contract 只断遍历与状态语义 |
| 不能改断言放行 | 不能把真实 SDK 返回类型改写进本地 interface；SDK 升级必须先通过 contract case |
| 观察失败显式报错 | SDK 形状在 compile / unit invoke 失败；真实运行保留 provider、操作与原始 cause |
| 用户侧直接定位 | 若进入 E2E，失败停在 sandbox provision / reconcile，不退化成 Report 对象缺失 |
| 设施不造假 | mock 从真实类型推导并覆盖多页；禁止 `as unknown as` 和 `mockResolvedValue(Array)` 发明形状 |
| 用户已有用法不改 | 用户的 Eval 与实验完全不变；缺的是框架自己的 provider 测试机制 |
