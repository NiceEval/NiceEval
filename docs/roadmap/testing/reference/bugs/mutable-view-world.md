# Bug 组：可变世界必须绑定私有状态与长驻公开入口

这一组用 view 热重载“全链路都响但页面仍旧”作正例，用 report E2E 的共享 evidence 被后续验收改写作反证。
两者方向相反：产品没有读到应该变化的状态，测试设施却意外读到了别的变化。

## 正例：watch、rebuild、reload 都发生，页面不变

fix commit `06588ff8` 前，`niceeval view` 使用 config 中的 Report 时只在启动阶段求值一次；显式 `--report` 虽给入口加 mtime query，它 import 的项目内依赖仍命中 ESM 缓存。
用户修改 Report 或依赖组件后，watcher、重建和浏览器 reload 都发生，最终页面仍逐字节不变。

公开错误事实是同一个长驻 `view` 会话在公开输入变化后没有收敛到新页面。
watcher 是否触发、模块 namespace 和缓存键都不是用户契约。

fix 前 `src/view/view-report.test.ts` 只重写报告入口 `.mjs`，还把 mtime 人工拨到未来；它没有改 import 依赖、没有走 config 重新装载，也没有保持一个真实 server 与浏览器会话。
所以最容易通过的 cache-busting 路径绿，真实用户路径仍坏。

`06588ff8` 加入了依赖子图和 config 的装载测试，但浏览器可见闭环仍应由一条窄 E2E 守住。
这需要一个新的、通用的长驻公开服务会话原语；普通 `cli()` 等进程退出，不能表达 dev server：

```ts
reportBehavior(viewReloadsAChangedReportDependency, async () => {
  const clone = await w.clone("view-hot-reload");
  const view = await service("pnpm exec niceeval view", {
    cwd: clone.consumerDir("report-project"),
    ready: { http: "/" },
  });
  const ui = await openSite(view.url, { hosting: "directory-root" });

  await expectWeb(ui.region("Report marker")).toContainText("FIRST_RENDER");
  await clone.run("change-report-dependency");
  await expectWeb(ui.region("Report marker")).toContainText("SECOND_RENDER");
  await expectWeb(ui.region("Report marker")).not.toContainText("FIRST_RENDER");
});
```

`service()` 只负责真实子进程生命周期、公开 URL 就绪、提前退出诊断与无条件收尾；DOM 等待仍用 Playwright 的自动重试。
它不暴露 watcher 或 rebuild 内部状态，不接受固定 sleep，也不把某条日志文案当 ready。

## 同形反证：验收自身改写了共享当前结果集

report E2E 的 `verifyReadback` 会在共享 `resultsRoot` 追加两次真实快照。
它之后运行的只读模块若现场调用 `show` / `view`，读到的是新 current scope，因而找不到 prepare 阶段保存的旧 locator。
`9cbd4f90` 的修法只是补充“依赖原 locator 的模块必须排在 verifyReadback 前”的顺序说明；产品没坏，测试设施制造了稳定假红。

这条反证证明仅有 action 序列还不够，action 必须绑定私有 world identity。
已有设计 `w.clone(mutationActionId)` 正好覆盖：

- 只读 proof 拿不到写权限，前后文件树 digest 必须一致。
- 需要变化的 proof 只通过签入的 `clone.run(actionId)` 修改自己的 clone。
- `service()`、浏览器和后续 `cli()` 都显式绑定同一个 clone，不从进程全局环境猜 results root 或 cwd。

因此不再保留“把会写的 verifier 排最后”作为候选方案；后续模块一增加，顺序约定还会重复失效。

## 新增原语的最小边界

本轮只新增 `service()`，不新增 `waitForReload()`、`watcherFired()` 或 `moduleGraphChanged()`。
服务会话适用于 `view`、文档站预览等任何长驻公开 CLI；变化是否完成由所属用户读面判断。

clone recipe 需要声明自己可变的路径和 action，默认仍是全只读。
如果 clone 只复制结果根而漏掉 Report 项目，`clone.run("change-report-dependency")` 应在 prepare 阶段直说 recipe 不完整，不回退为直接写共享目录。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 断公开页面从旧标记收敛到新标记；不锁 reload 次数、日志或模块实例 |
| 不能改断言放行 | 两个标记由签入 action 的前后输入决定，不能把 SECOND 改成当前旧页面 |
| 观察失败显式报错 | 服务提前退出、HTTP 未就绪、区域缺失分别在 invoke / observe 报错 |
| 用户侧直接定位 | 消息含服务命令、cwd、URL、mutation action、实际 DOM 文本与 stderr 尾部 |
| 设施不造假 | 无固定 sleep；私有 clone；服务、浏览器、CLI 绑定同一 world digest；收尾检查子进程退出 |
| 用户已有用法不改 | 仍是普通 `niceeval view` 和原 Report；变更动作由验收 recipe 提供 |
