# Sandbox 怎么测

契约来源：[Sandbox](../../../feature/sandbox/README.md)、[Architecture](../../../feature/sandbox/architecture.md)、[Library](../../../feature/sandbox/library.md)、[操作](../../../feature/sandbox/library/operations.md)、[结果断言](../../../feature/sandbox/library/asserting-results.md)、[本地执行](../../../feature/sandbox/local.md)、[串行复用](../../../feature/sandbox/serial-reuse.md)、[CLI](../../../feature/sandbox/cli.md)。单测证明 provider 共同契约、路径规则、重试分类和生命周期；真实容器与云 provider 连通性由 [E2E](../e2e/README.md) 用真实沙箱验证。本篇的缝：内存 provider 实现自有 `Sandbox` 接口，测 provider 之上的共同逻辑；同一 contract suite 的真实侧由 E2E 沙箱仓库对真实 provider 执行（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。

## Fixture 规范

大多数上层测试只需要记录交互，不需要模拟 shell：

```ts
function recordingSandbox(results: readonly CommandResult[]): SandboxFixture {
  const commands: CommandCall[] = []
  let cursor = 0

  return {
    sandbox: {
      workdir: "/home/sandbox/workspace",
      sandboxId: "fixture",
      otlpHost: null,
      async runCommand(command, args, options) {
        commands.push({ command, args, options })
        const result = results[cursor]
        cursor += 1
        if (result === undefined) throw new Error("missing command result fixture")
        return result
      },
      // 其余方法由公共 test factory 提供明确的 unsupported 默认实现。
      ...sandboxMethodStubs(),
    },
    commands,
  }
}
```

默认 stub 抛出 `unexpected sandbox call`，不静默返回空值——生产代码意外增加一次文件读取时，测试会失败而不是用假数据继续通过（规则见 [Harness](harness.md)）。

生命周期测试的 fixture 只记录事件序列，期望顺序以 [Architecture](../../../feature/sandbox/architecture.md) 的调用链为准，fixture 不自行排序。资源测试覆盖成功、setup 失败、test 失败和中断四条路径。临时文件测试用每例独立的 `mkdtemp` 目录并在收尾删除，不共享固定路径。重试类测试用 `TestClock` 推进，不做真实等待。

Provider 共同语义用同一组 contract cases 验证：内存 provider 在 unit 套件跑这组 contract；Docker、Vercel、E2B 的真实创建和网络行为由 E2E 沙箱仓库对真实实例调用同一 contract suite。

## 覆盖规范

- **生命周期与资源释放**：attempt 调用链的固定顺序与缺省跳过；setup 抛错时已成功部分的逆序 cleanup、teardown 与 stop 的 finally 语义；setup 抛错计 errored 而 teardown 报错只记日志；逐段清理超时的诊断收束；`.setup()`/`.teardown()` 的追加序/LIFO 与 spec 不可变；创建后被终止属 lifecycle failure 不进 IO 重试；remote agent 下 spec 整体忽略；hook 的窄上下文。失败与中断路径的清理和成功路径同等重要。
- **路径规则**：沙箱侧相对/绝对/缺省三态解析、`../` 规范化与逃逸拒绝、无 shell 变量展开、本地侧按 eval 定义文件目录解析——适合表驱动，每个 case 指向一条允许或拒绝语义。
- **命令执行**：argv 传参不经 shell（含分号/美元符的参数原样送达——参数透传能发现错误的 shell 拼接，断言 mock 被调一次不能）；非零退出返回 CommandResult 而非抛异常；env 叠加不清空；root 的映射与不支持时报错；命令级超时；可选能力未实现时的 no-op 语义；执行入口永不被隐式重试。
- **文件操作与 IO 重试**：只有幂等固定目标操作进默认重试；瞬时/非瞬时错误的分类边界；`fileExists` 遇瞬时错误必须抛出不伪装 false；重试耗尽抛回原始错误链；批量写的重跑等价性；读取 API 的缺失行为与二进制完整性；`downloadDirectory` 与 `uploadDirectory` 对称的 `ignore` 语义(按 basename 排除、命中即整支剪除,不区分文件与目录)与落盘行为(自动建目录、原样二进制字节、不做编码转换、不返回带便利方法的包装类型)——docker(单次 tar 取回后按首段路径剥离归位)与 vercel/e2b(共享的 find 列路径 + 逐文件二进制读取模板)两条实现路径都要证明。
- **Provisioning 失败与重试**：原生限流归类、兜底瞬时分类器复用、可重试 kind 的退避与确定性错误零重试；退避期间归还并发槽位；有对账通道时先对账再重试、对账失败放弃并抛回原始错误、无通道时歧义类零重试；自定义 provider 不套用这层重试。相关裁决与踩坑见 memory 的 [sandbox-provision-ratelimit-retry](../../../../memory/sandbox-provision-ratelimit-retry.md)、[e2b-provision-429-duplicate-sandbox](../../../../memory/e2b-provision-429-duplicate-sandbox.md)。
- **diff 与结果断言**：分类账锚点与 send 窗口归因（环境钩子、eval Fixture、send 后校验写入都不进 agent diff）；窗口标签与轮标签同枚 token、按等值匹配；默认排除与 ignore/include 的 glob 语义、nested repo 不静默吞改动；`noFailedShellCommands` 只看 agent 自己的调用；延迟断言 finalize 时对最终 diff 求值。
- **provider 选择与作者面**：sandbox 字段无裸字符串/无默认/无探测、两处皆空报错带下一步；自定义 provider 直接调用、核心路径无 provider 名分支；`t.sandbox` 的错误反馈带 API 名与 agent 名；反馈经管线不经 stdout。
- **Checkpoint**：打包/解压失败直接抛错不冒充成功，临时归档按 finally 清理。
- **Local provider**：仓库根解析与仓库外报错；只观察不还原（用户 git 状态不被触碰、stop 不删工作树）；不提权；与 keep 组合创建前报错。
- **串行复用**：不随 eval 变的层整组只执行一次、 Fixture 每题重放；题间重置尊重排除清单；温基线即归因锚点（跨题 diff 零串扰）；互斥与异构批次在创建前报错；与指纹缓存双向绝缘（复用 attempt 不作缓存来源，复用 run 也不消费携带——存在可携带终态时计划内 attempt 仍全量派发）；显式 `--max-concurrency` 组合是创建前用法错误且与值无关（`1` 也报），环境层并发缺省被覆盖为 1 并在 PLAN 标注。
- **孤儿核对与 prune**：创建期运行标识元数据的写入边界；孤儿三条件与 unverified 的保守判定；prune 的幂等、`--force` 语义与失败退出码。
- **留存(keep)登记项的 `expiresAt`**：按 provider 声明的保留期限计算——vercel 写 `keptAt` 加默认快照保留期(30 天),e2b(pause 官方契约无自然过期)与 docker(本地停驻,非远端保留期概念)都不写；`niceeval sandbox list` 的过期分支据登记项的 `expiresAt` 展示保留截止时刻。
- **detached 生命周期路由(`keep.ts`)**：`nativeEnterCommand`/`wakeDetached`/`suspendDetached`/`inspectDetached`/`destroyDetached`/`execInDetached` 三 provider 分支各自的正常路径与失败路径——mock 各自 SDK 模块(`dockerode`/`e2b`/`@vercel/sandbox`),不发真实请求。vercel 分支专门证明:唤醒走 `Sandbox.get({ name, resume: true })`(name 而非 sessionId,与官方 CLI/SDK 按 name 索引一致)、查状态与销毁走 `resume:false` 不产生唤醒副作用、销毁调用 `delete()` 而非 `stop()`(`stop()` 是可恢复的 suspend,不是永久销毁)；`detachedCapabilityGap` 对已知三 provider 返回 undefined、对未知 provider 名返回可展示的原因(供 CLI 报「不支持,原因」而不是逐条 `if (provider === …)`)。
- **`sandbox enter`/`history`/`diff` 的能力路由(`cli-commands.ts`)**：三条命令统一走"能力声明 gap 检查 → 唤醒 → 操作 → 回眠"路径,不含 provider 名分支——docker 与 e2b 各证明一次唤醒成功路径;interactive enter 的原生命令 spawn 失败(未装对应 CLI)现场保持 alive 并提示直连命令,不误判成功;条目级 lease 互斥——`enter` 持有 lease 时并发 `stop` 拒绝并报出 holder,过期 lease 允许下一个命令接管并如实提示。

## 不这样测

- 不在 Context 测试里重新实现一个会执行真实 shell 的 fake Sandbox。
- 不断言 Docker SDK、Vercel SDK 或 E2B SDK 的构造器本身工作。
- 不只测 happy path；资源泄漏通常出现在失败和中断。
- 不允许未实现的 fake 方法静默返回空字符串、空数组或成功结果。
- 不在单测里连真实容器验证连通性；真实 provider 行为归 E2E 沙箱仓库。
