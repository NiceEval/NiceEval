# Bug 组：构建的就绪关系可观察，执行身份不能自证

这一组把两个构建缺陷分开处理。
逐 BuildKey 放行是公开事件之间的时序关系，用户侧可以直接证明；平台进入 BuildKey 却是身份与实际执行是否一致的问题，现有公开记录只能重复实现自己的声明，不能独立证明。

## 正例：一个慢 BuildKey 挡住所有 attempt

MemoryBench 真机曾出现 13 道题中 10 个镜像已经 ready，界面仍为 `0 running · 13 queued`，全体等待最慢构建约 7 分钟。
fix 实现在 `b24b22d2`：runner 从等待全部构建改成每个 eval 只等待自己引用的 key；`c0bc7915` 又把旧测试“构建全部结束后才派发”改成区分力测试——慢构建必须等到无依赖的 eval 已经开跑才返回，全局 barrier 会直接死等。

公开错误事实不是“运行太慢”，而是两个活动区间的先后关系错误：不依赖慢 key 的 attempt 不应等待该 key 完成。
fix 前构建协调器单测能证明 single-flight、为所有依赖者写入同一失败和整批完成，却没有证明一个 key settle 时可以独立放行；runner 测试甚至把全局 barrier 当作正确行为，所以全绿。

`exp --json` 已公开 `run_activity` 的 `id`、`key`、`status` 与 attempt 起止事件。
第 2 轮的区间原语可以直接复用，不需要构建专用 matcher：

```ts
runnerBehavior(aReadyBuildReleasesOnlyItsDependents, async () => {
  const { stdout } = await cli("pnpm exec niceeval exp two-builds --rerun all --json");
  const timeline = ndjsonEvents(stdout).timeline();

  expectObserved(timeline.happensBefore({
    left: { event: "attempt_started", eval: "independent" },
    right: { event: "run_activity", key: "sandbox.build", id: "slow", status: "done" },
  })).toEqualValue(true);
});
```

这里的 `slow` 是 world recipe 签入的活动身份，不从完成顺序反推。
失败信息列出两侧事件及其来源行；缺任何一侧先在 observe 阶段报“无法建立关系”，不会把缺证据解释成 false。

同形反证是 `03de80d8` 的实验级并发误钳全局：一个是慢 BuildKey 错挡无关 attempt，一个是串行实验错挡无关 experiment，二者都由“本作用域的活动不得阻塞无依赖活动”这条区间关系捕获。
因此不新增 `buildIsIncremental()` 之类单例断言。

## 反证：平台字段第一次修完后仍错

`b24b22d2` 首次修复平台事实：不再把 `linux/amd64` 写死进 BuildKey，而是探测 Docker 执行环境，并把同一个值交给构建命令。
当时新增单测分别注入 arm64 / amd64 探测值，证明 BuildKey 不同，并检查 `DOCKER_DEFAULT_PLATFORM` 与 key 输入同源。

但 `a7584de3` 的第二轮复查发现同形缺陷仍在：Compose 的 service `platform` 与 `build.platforms` 才是更高优先级的构建事实，首次实现没有解析它们。
于是平台声明不同的两个 case 仍可能共用 BuildKey；已有探测测试继续全绿，因为它只覆盖回落来源。

这条反证否定两个候选：

- 只断 `sandboxBuilds.inputs.platform` 存在。该字段与 BuildKey 来自同一实现，错误实现可以自洽地一起撒谎。
- 用户 Eval 里新增 `uname -m`。这要求用户为了框架验收改题目，而且只覆盖恰好增加探针的 Eval。

当前最早应失败的是结构 / 单元层：枚举公开声明的优先级，换宿主探测值后证明显式声明身份不动、未声明身份随宿主变化、多平台在规划期显式拒绝；同时把最终有效平台交给注入的真实构建调用边界。
`a7584de3` 新增的测试正具备这种区分力。

## 机制缺口：执行侧平台证明

如果要从用户侧独立证明“实际构出的镜像就是 BuildKey 声称的平台”，框架必须从 provider 或镜像 manifest 取得执行侧证明，并与声明值分别落盘。
现有 `sandboxBuilds` provenance 只有框架准备交给构建器的值，没有实际产物的独立证明；普通 proof 不能据此排除构建器忽略参数。

因此本轮不造 `buildPlatformMatchesKey()`。
在框架增加可公开读取的 `declaredPlatform` / `observedPlatform` 或等价证明前，这一项归机制缺口；已有刚好输出架构的 Eval 可以做高成本 smoke，但不能升格为通用验收。

## 六项检查

| 检查 | 逐 key 放行 | 平台身份 |
|---|---|---|
| 契约不变不误红 | 比事件先后，不比 7 分钟或固定阈值 | 结构测试比优先级与同源关系，不依赖当前宿主架构 |
| 不能改断言放行 | 无依赖关系来自签入 world，不能改成实际完成顺序 | 不接受把期望 platform 改成实现输出；声明来源是输入事实 |
| 观察失败显式报错 | 缺 start / done 先报 observe 失败 | provider 没有执行证明时明确列机制缺口 |
| 用户侧直接定位 | 列活动 id、attempt id 与事件行 | 单元错误列 Compose service、声明来源、有效平台与构建入参 |
| 设施不造假 | 慢构建由 barrier 释放，不靠 sleep 判定 | 注入的是构建调用边界；不拿 provenance 自证 provenance |
| 用户已有用法不改 | 复用普通 Compose Eval 与 `--json` | 不要求 Eval 增加 `uname` 或内部探针 |
