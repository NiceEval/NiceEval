# Bug 组：消费方执行上下文必须进入 world 身份

这一组用 CJS 宿主装载失败作正例，用跨 cwd TSX Report 装载失败作同形反证。
两条 bug 都不是用户文件内容错误，而是 NiceEval 只在自己的仓库上下文中证明了装载行为。

## 正例：CJS 项目加载不了 `init` 生成的 config

`npm init -y` 默认创建 CommonJS 项目。
fix commit `b44420d3` 前，`niceeval init` 能成功写出 `niceeval.config.ts`，但下一条 `niceeval list` 会因 CJS loader 未注册或 exports 缺 `require` 条件而崩溃。

公开错误事实是同一个官方工作流不能连续执行，而不是用户选择了错误模块形态。
仓库自己的 `package.json` 是 ESM，示例也都声明 ESM；当时 87 个测试文件没有 CJS consumer。
typecheck 只检查源码 import，不会让打包入口在另一个项目的 CJS loader 下执行。

fix 新增的 `test/package-exports.test.ts` 守住 exports 与双 hook 两条结构事实，失败比 E2E 更早。
但它仍不能独立证明 `init → list` 的公开任务，所以最小方案是结构守护加一个真实 consumer proof，而不是二选一。

```ts
packageBehavior(initOutputLoadsInCommonJs, async () => {
  const cwd = w.consumerDir("commonjs");
  await cli("pnpm exec niceeval init", { cwd });
  const { stdout } = await cli("pnpm exec niceeval list", { cwd });
  expectObserved(evalCatalog(stdout).ids()).toShowRows(["smoke"]);
});
```

## 同形反证：跨 cwd 装载 TSX Report

fix commit `d8d5a84b` 处理了相同的上下文遗漏。
报告文件在自己的项目 cwd 下可用，从 NiceEval 仓库用绝对路径装载时却按宿主 cwd 的 tsconfig 编译，最终报 `React is not defined`。

fix 前的 `host.test.ts` 只证明文件与内建报告的分流，并用不存在文件检查错误族。
view 热重载测试使用与结果根同目录的 `.mjs`，既没有 TSX，也没有 foreign cwd。
所有测试都绕开了真正决定 JSX runtime 的「被加载文件属于哪个项目」。

fix 新增的 `src/report/runtime/load.test.ts` 已用临时 TSX 与邻近 tsconfig 捕获低层根因。
用户侧 proof 仍应通过真实 `niceeval show --report` 证明公开入口、候选包与报告组件一起工作。

```ts
reportBehavior(loadsReportFromItsOwnProject, async () => {
  const { stdout } = await cli(
    `pnpm exec niceeval show --record ${w.resultsRoot} --report ${w.reportFile("foreign")}`,
    { cwd: w.hostDir },
  );
  const report = reportView(stdout);
  expectObserved(report.table("Attempts").rowIds()).toShowRows(["tool-call"]);
});
```

两条 proof 共用 consumer world 与真实 `cli()`，差别只在 recipe 的上下文轴。
因此 world 身份必须包含候选包、入口、consumer `package.json`、lockfile、tsconfig、宿主 cwd 与被加载文件路径；缺任何一项都可能错误复用证据。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | 只断工作流可执行与稳定对象身份，不锁 JSX 输出、完整标题或栈文案 |
| 不能改断言放行 | CommonJS 与 foreign cwd 是声明的支持矩阵；不能删除红的 scenario 或把崩溃列为允许结果 |
| 观察失败显式报错 | 静态登记错误在运行前失败，world 身份不符在 prepare 失败；CLI 装载崩溃在 invoke 失败；对象缺失在 observe 失败 |
| 用户侧直接定位 | 失败列出 consumer 形态、宿主 cwd、报告路径、候选包摘要、命令与 stderr |
| 设施不造假 | consumer 从候选 tarball 的本地 bin 启动；不允许用 checkout 的 bin 跨过 consumer 模块边界 |
| 用户已有用法不改 | 用户仍写普通 config 与 Report；上下文矩阵由 prepare 复制最小项目生成 |
