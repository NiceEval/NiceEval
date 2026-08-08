# Bug 组：进程内收尾与进程外认领是两种闭包

这一组用强清路径拦腰切断 teardown 作正例，用 SIGKILL 后 Compose 资源集合不进入 orphan 清单作反证。
前者能在进程退出前完成，后者物理上只能事后恢复；测试不能用同一种“终于没有资源”掩盖两条责任边界。

## 正例：二次 Ctrl+C 跳过实验 teardown

真实批跑中，第一次 Ctrl+C 后优雅停 sandbox 超时，二次 Ctrl+C 进入强清。
旧实现只停 sandbox，随后直接 `process.exit(130)`；实验 teardown 管理的容器、隧道和 license 席位留下。

第一版 fix `5eb19b7b` 增加宿主侧 teardown 注册表、逐段回收上限和强清 drain。
但真机再次复现：强清只等 15 秒，而单个合法 teardown 上限是 30 秒；正在执行的 teardown 又已从注册表取走，drain 看不见它。

第二版 `14e5207` 才形成区分力闭包：teardown 是 memoized promise，正常路径与 drain 等同一个 settle；强清时限由回收常量推导，并以实际 settle 为退出条件。
新增单测证明并发到达只执行一次且双方都等待，但没有真实 CLI 信号与外部资源的 E2E。

用户侧 proof 复用第 3 轮的长驻服务会话：

```ts
runnerBehavior(secondInterruptStillWaitsForTeardown, async () => {
  const w = world("interrupt-cleanup");
  const run = await service("pnpm exec niceeval exp long-running --rerun all", { cwd: w.consumerDir("cleanup") });

  await run.signal("SIGINT");
  await run.signal("SIGINT");
  await expectObserved(run.exit()).toEqualValue({ code: 130, signal: null });
  await expectObserved(externalState(w).resourceIds()).toShowExactRows([]);
});
```

`externalState` 由 recipe 选择一个本地、可独立核对的资源，例如测试容器或 mock license server。
它不是读取 runner 注册表；如果资源状态无法从进程外核对，该场景就不能充当 cleanup E2E。

## 同形反证：SIGKILL 后只能按归属认领

SIGKILL 下任何进程内 finally 都来不及执行。
早期设计虽给单 sandbox 打运行标签，却没有可用的事后入口；后来 Compose case 又暴露同形遗漏：`sandbox list --orphans` 只查单容器，组内 sidecar 和网络不在核对面。

`b24b22d2` 把运行身份写到每个受管服务与网络，并按 Compose project 合成一个候选；prune 先删容器再删网络。
fix 新增了全面的 mock 单测，但没有真实 Docker CLI roundtrip。

```ts
sandboxBehavior(killedComposeRunCanBeRecoveredAsOneGroup, async () => {
  const run = await service("pnpm exec niceeval exp compose-long --rerun all", { cwd: w.consumerDir("compose") });
  await run.signal("SIGKILL");

  const before = sandboxInventory((await cli("pnpm exec niceeval sandbox list --orphans")).stdout);
  expectObserved(before.group("compose-long").resources())
    .toEqualValue({ containers: 2, networks: 1, state: "orphan" });

  await cli("pnpm exec niceeval sandbox prune");
  const after = sandboxInventory((await cli("pnpm exec niceeval sandbox list --orphans")).stdout);
  expectObserved(after.groupIds()).toShowExactRows([]);
});
```

`sandboxInventory()` 是本轮新增的最小领域读面。
它只读取公开 `sandbox list` 输出里的 group identity、状态和资源数；provider 原生命令只用于测试设施的异常回收，不充当产品断言。

## 删除的候选

- “收到 SIGKILL 时跑 teardown”：物理上不可实现，删除。
- 只断容器数量为 0：会漏网络、外部服务和误删活资源，删除。
- 单元里 mock `process.exit` 后检查注册表为空：证明不了真实信号、子进程和外部资源，降为单元守护。
- 固定 sleep 后查资源：回收有公开上限时等 settle；进程外核对用最终状态重试，不把机器速度写进契约。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | SIGINT proof 等 settle；SIGKILL proof 查事后归属，不要求不留瞬时资源 |
| 不能改断言放行 | 强清退出前资源必须收束；SIGKILL 后必须能列出并整组 prune |
| 观察失败显式报错 | 服务未进入运行态、inventory 读取失败、候选 unverified 都单独报错 |
| 用户侧直接定位 | 列命令、signal、run identity、group、容器 / 网络数与 prune 输出 |
| 设施不造假 | 产品断言走 NiceEval CLI；异常回收另记并总会执行，避免残留污染后续测试 |
| 用户已有用法不改 | 复用原 Experiment teardown、Compose 和官方 sandbox 命令 |
