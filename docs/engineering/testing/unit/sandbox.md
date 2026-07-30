# Sandbox 怎么测

契约来源：

- [Sandbox](../../../feature/sandbox/README.md)
- [Architecture](../../../feature/sandbox/architecture.md)
- [Library](../../../feature/sandbox/library.md)
- [操作](../../../feature/sandbox/library/operations.md)
- [结果断言](../../../feature/sandbox/library/asserting-results.md)
- [本地执行](../../../feature/sandbox/local.md)
- [Sandbox 复用](../../../feature/sandbox/reuse.md)
- [CLI](../../../feature/sandbox/cli.md)

单元测试证明 Provider 共同契约、路径规则、重试分类和生命周期。
内存 Provider 实现自有 `Sandbox` 接口，测试 Provider 之上的共同逻辑。
真实容器与云 Provider 的连通性，由 E2E 沙箱仓库对同一 contract suite 执行。
Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## Fixture 规范

大多数上层测试只需要记录交互，不需要模拟 shell：

```ts
function recordingSandbox(results: readonly CommandResult[]): SandboxFixture {
  const commands: CommandCall[] = [];
  let cursor = 0;

  return {
    sandbox: {
      workdir: "/home/sandbox/workspace",
      sandboxId: "fixture",
      otlpHost: null,
      async runCommand(command, args, options) {
        commands.push({ command, args, options });
        const result = results[cursor];
        cursor += 1;
        if (result === undefined) throw new Error("missing command result fixture");
        return result;
      },
      // 其余方法由公共 test factory 提供明确的 unsupported 默认实现。
      ...sandboxMethodStubs(),
    },
    commands,
  };
}
```

默认 stub 抛出 `unexpected sandbox call`，不静默返回空值——生产代码意外增加一次文件读取时，测试会失败而不是用假数据继续通过（规则见[Harness](harness.md)）。

生命周期测试的 fixture 只记录事件序列，期望顺序以[Architecture](../../../feature/sandbox/architecture.md)的调用链为准，fixture 不自行排序。
资源测试覆盖成功、setup 失败、test 失败和中断四条路径。
临时文件测试用每例独立的 `mkdtemp` 目录并在收尾删除，不共享固定路径。
重试类测试用 `TestClock` 推进，不做真实等待。

Provider 共同语义用同一组 contract cases 验证：内存 provider 在 unit 套件跑这组 contract；Docker、Vercel、E2B 的真实创建和网络行为由 E2E 沙箱仓库对真实实例调用同一 contract suite。

## 覆盖规范

- **生命周期与资源释放**：attempt 调用链的固定顺序与省略对应 Hook 时跳过；setup 抛错时已成功部分的逆序 cleanup、teardown 与 stop 的 finally 语义；setup 抛错计 errored 而 teardown 报错只记日志；逐段清理超时的诊断收束；`.setup()`/`.teardown()` 的追加序/LIFO 与 spec 不可变；创建后被终止属 lifecycle failure 不进 IO 重试；remote agent 下 spec 整体忽略；hook 的窄上下文。
  失败与中断路径的清理和成功路径同等重要。
- **路径规则**：沙箱侧相对/绝对/省略三态解析、`../` 规范化与逃逸拒绝、无 shell 变量展开、本地侧按 eval 定义文件目录解析——适合表驱动，每个 case 指向一条允许或拒绝语义。
  `normalizeSandboxPaths` 对接口之外的可选能力（`appendLog`、`suspend`）按「实例有就转发、没有就是 undefined」原样传递，不吞掉——留存路径的 `sandbox.suspend`（`keep.ts` 的 `suspendSandbox`）经这层包装后仍能找到底层 provider 实例的 `suspend()`，找不到时抛出的是「没有 suspend 能力」而不是「转发时误吞成 undefined」。
  `suspendSandbox` 自身两条路径都要证明：底层实例有 `suspend()` 时原样调用、没有时抛出带 `sandboxId` 的清晰错误（不是静默跳过）。
- **命令执行**：argv 传参不经 shell（含分号/美元符的参数原样送达——参数透传能发现错误的 shell 拼接，断言 mock 被调一次不能）；非零退出返回 CommandResult 而非抛异常；env 叠加不清空；root 的映射与不支持时报错；命令级超时；可选能力缺席时的 no-op 语义；执行入口永不被隐式重试。
- **失败命令证据包装**：公开 `runCommand` / `runShell` 最外层调用非零退出时，在把 `CommandResult` 交还调用方前登记一次 `FailedCommandEvidence`，并与同一次 timing command node 共用 id；成功命令不登记输出；provider 内部 `runCommand → runShell` 转调不重复；调用方处理非零结果并继续不撤销证据；stdout/stderr 原换行与首部 EACCES/path 保留，不能先 tail-only 再交 writer。
  fixture 必须让 Eval 随后把错误 `.slice(-500)`，仍能从登记项读到前部根因，证明捕获时点正确。
- **文件操作与 IO 重试**：只有幂等固定目标操作进默认重试；瞬时/非瞬时错误的分类边界；`fileExists` 遇瞬时错误必须抛出不伪装 false；重试耗尽抛回原始错误链；批量写的重跑等价性；读取 API 的缺失行为与二进制完整性；`downloadDirectory` 与 `uploadDirectory` 对称的 `ignore` 语义(按 basename 排除、命中即整支剪除,不区分文件与目录)与落盘行为(自动建目录、原样二进制字节、不做编码转换、不返回带便利方法的包装类型)——docker(单次 tar 取回后按首段路径剥离归位)与 vercel/e2b(共享的 find 列路径 + 逐文件二进制读取模板)两条实现路径都要证明。
- **Provisioning 失败与重试**：原生限流归类、回退瞬时分类器复用、可重试 kind 的退避与确定性错误零重试；退避期间归还并发槽位；有对账通道时先对账再重试、对账失败放弃并抛回原始错误、无通道时歧义类零重试；自定义 provider 不套用这层重试。
  相关裁决与踩坑见 memory 的[sandbox-provision-ratelimit-retry](../../../../memory/sandbox-provision-ratelimit-retry.md)、[e2b-provision-429-duplicate-sandbox](../../../../memory/e2b-provision-429-duplicate-sandbox.md)。
- **Provisioning 确定性死因的对外 scope 映射**：三档确定性配置死因（凭据缺失、权限不足、模板不存在）从 provider 原生错误形态（含跨 cause 链走查）的识别，以及识别后按[执行失败分类](../../../feature/error-classification/README.md)的结构化契约（`_tag` + `class`）附着到错误对象；按死因的配置解析域定档——凭据缺失、权限不足恒定档 `scope: "experiment"`（与 spec 是否带 `environments` 表无关），模板不存在按 spec 带不带 `environments` 表二分（带表定档 `scope: "eval"`、不带表定档 `scope: "experiment"`）；瞬时失败（拒绝类/歧义类）重试耗尽后不附带 scope，确定性死因未命中三档词表之一时同样不附带 scope。
- **diff 与结果断言**：分类账锚点与 send 窗口归因（环境生命周期 Hook、Eval Fixture、send 后校验写入都不进 Agent diff）；窗口标签与轮标签同枚 token、按等值匹配；默认排除与 ignore/include 的 glob 语义、nested repo 不静默吞改动；`noFailedShellCommands` 只看 Agent 自己的调用；延迟断言 finalize 时对最终 diff 求值。
- **导出预算与内容省略**：预算只数真正传输的文本字节。
  二进制与超 1 MiB 文本按 `elided` 记字节数、不占预算；编译产物型窗口因此整体放行，这一格在「按尺寸计」的旧口径下会红。
  纯文本传输字节越界仍报执行错误。
  `elided` 往返与派生视图各一格；被省略内容的读取按证据不可用报错，存在性与 `status` 断言照常成立。
- **provider 选择与作者面**：sandbox 字段不接受 provider 名字符串、没有默认值、不会自动探测。
  两处皆空时，报错给出下一步；自定义 provider 直接调用、核心路径无 provider 名分支；`t.sandbox` 的错误反馈带 API 名与 agent 名；反馈经管线不经 stdout。
- **官方 E2B coding-agent 模板契约**：Claude Code / Codex 继续继承各自的 E2B 官方模板，Bub 继续使用固定配方；三条配方都必须把运行用户的 npm global prefix 收敛为 `/usr/local`，并显式准备可写的 `/usr/local/bin` 与 `/usr/local/lib/node_modules`。
  结构测试读取 `Template.toJSON()` 证明这两步都存在；真实 build 对运行用户执行 prefix、PATH 与目录写权限自检。
  不能只测 Agent CLI 可执行——不同官方基线的 Node 安装位置恰好会让 CLI 自检通过而后续 `npm install -g` 整片失败。
- **官方基线制品的版本与发布台账**：公共 E2B template 与 Docker image 的版本 tag 是 `<Agent 版本>-r<配方修订>`，版本位取自与 Adapter 运行时回退安装同一批的版本常量，niceeval 自身的版本不出现在 tag 里；同一个 Agent 在已发布的 provider 上共用同一个版本号。
  Docker 侧覆盖全部 `CodingAgentBaseline`；E2B 侧是子集（`E2BCodingAgent`），未进台账的 Agent 不导出 E2B 常量。
  导出的具名常量必须指向**已发布**制品：E2B 侧逐 agent 与 `sandbox/e2b/published.json` 的台账逐字段核对（tag、name、台账记录的 Agent 版本与源码版本常量一致，bub 另核对安装指纹），版本常量走在发布前面时这一格红；唯一的放行方式是台账条目显式写下待发布的 tag（`supersededBy`），默不作声的分叉必须红——那正是「常量指着装了旧 Agent 的制品」而全绿的形态。
  Bub 的安装指纹要证明 `version` 与 `otelPlugin` 都参与：换任一个都换指纹（否则预装环境的 marker 会在配方已变时继续命中，装到上一代）。
  跨语言的同源值（`sandbox/docker/Dockerfile` 的 `ARG` 默认值、`bub-override.txt`、镜像里写死的 marker）不能导入 TypeScript，因此逐个与源码常量比对——漂移只在真实构建时才暴露，类型检查一次都拦不住。
  OpenClaw 的版本位是 calver（如 `2026.7.1-2`），tag 形如 `2026.7.1-2-r1`，守护正则必须覆盖这种形态，不能只认三段 semver。
- **Checkpoint**：打包/解压失败直接抛错不冒充成功，临时归档按 finally 清理。
- **Local provider**：仓库根解析与仓库外报错；只观察不还原（用户 git 状态不被触碰、stop 不删工作树）；不提权；与 keep 组合创建前报错。
- **Sandbox 复用**：
  - 配置：`sandboxReuse: true` 进入配置哈希，省略时每 Attempt 全新 Sandbox。
  - Hook：SandboxSpec Hook 每个 Sandbox 成对一次；Agent 与 Eval Hook 每 Attempt 成对一次。
  - 重置：题间 reset 尊重排除清单，重置点仍是归因锚点。
  - 调度：覆盖 `maxConcurrency: 1`、并行复用、按需创建和派发前续期。
  - 寿命：覆盖 `lifetimeMs` 不足时更换、reset 失败淘汰和中途消失不静默重跑。
  - 能力归属：`SandboxReuseCapability` 只能来自 Provider 实现。
    要有「provider 没有该能力 + `sandboxReuse: true` → 第一条 Attempt 派发前硬失败」的区分力场景。
    不允许任何通用记账层让它静默通过。
  - 调度事实：`sandbox.provider` / `sandboxId` / `reused` / `reuseSandbox` / `reuseOrdinal` 在租借时刻确定。
    Eval `setup` 失败与超时的 attempt 记录同样带全这些键。
    fixture 要造 setup 阶段失败的场景，断言字段在场。
  - 复用污染诊断：某实例承接序号 ≥ 2 的 Attempt 集中失败于同一阶段时产出运行级 diagnostic（点名实例、序号区间与阶段）；首承接失败或失败不聚集时不误报。
  - 组合：`--keep-sandbox` 与 `localSandbox()` 的互斥在创建前报错。
  - 结果：复用 Attempt 不作结果沿用来源，复用 Experiment 也不消费结果沿用。
- **孤儿核对与 prune**：创建期运行标识元数据的写入边界；孤儿三条件与 unverified 的保守判定；prune 的幂等、`--force` 语义与失败退出码。
- **留存(keep)登记项的 `expiresAt`**：按 provider 声明的保留期限计算——vercel 写 `keptAt` 加默认 Run 保留期(30 天),e2b(pause 官方契约无自然过期)与 docker(本地停驻,非远端保留期概念)都不写；`niceeval sandbox list` 的过期分支据登记项的 `expiresAt` 展示保留截止时刻。
- **detached 生命周期路由(`keep.ts`)**：`nativeEnterCommand`/`wakeDetached`/`suspendDetached`/`inspectDetached`/`destroyDetached`/`execInDetached` 三 provider 分支各自的正常路径与失败路径——mock 各自 SDK 模块(`dockerode`/`e2b`/`@vercel/sandbox`),不发真实请求。
  探测抛错必须归 `unknown`，只明确未找到才归 `expired`；vercel 销毁只吞明确 404。
  vercel 分支专门证明:唤醒走 `Sandbox.get({ name, resume: true })`(name 而非 sessionId,与官方 CLI/SDK 按 name 索引一致)、查状态与销毁走 `resume:false` 不产生唤醒副作用、销毁调用 `delete()` 而非 `stop()`(`stop()` 是可恢复的 suspend,不是永久销毁)；`detachedCapabilityGap` 对已知三 provider 返回 undefined、对未知 provider 名返回可展示的原因(供 CLI 报「不支持,原因」而不是逐条 `if (provider === …)`)。
- **`sandbox enter`/`history`/`diff` 的能力路由(`cli-commands.ts`)**：三条命令统一走"能力声明 gap 检查 → 唤醒 → 操作 → 回眠"路径,不含 provider 名分支——docker 与 e2b 各证明一次唤醒成功路径;interactive enter 的原生命令 spawn 失败(未装对应 CLI)现场保持 alive 并提示直连命令,不误判成功;条目旁 `.lease` 以 `wx` 原子占坑，竞争者拒绝并报 holder，TTL 接管后原持有者释放不得删掉后来者。
- **`list`/`history` 一次性面板接线到 `panel.ts`（`cli-commands.ts`）**：面板几何本身（宽度上限、截断优先级、CJK 量测……）由[Reports 的「面板几何」类别](reports.md#覆盖规范)覆盖，这里只证明两条命令真的把内容交给 `renderPanel` 而不是各自拼框字符——`history` 对着一段固定的 git 日志 fixture（anchor + 交替的 eval/agent 提交，逐提交 mock `git diff --name-status` 的文件改动）核对完整输出与 `docs/feature/sandbox/cli.md` 的框线示例逐字一致（含 `eval` 提交按「首次 = fixture / setup、之后 = post-send validation」分类、`agent` 提交的文件改动列表、下边框嵌最近一个窗口的 `diff --window` 命令）；`list` 核对启动时探测到的传输能力（`io.isTTY`/`columns`）经 `panelCapabilityOf` 正确转成 `renderPanel` 的 `mode`/`width`——非 TTY（未声明 `isTTY` 的既有测试默认场景）不产生任何框字符，`isTTY: true` 时产生可识别的框线字符。

## 不这样测

- 不在 Context 测试里重新实现一个会执行真实 shell 的 fake Sandbox。
- 不断言 Docker SDK、Vercel SDK 或 E2B SDK 的构造器本身工作。
- 不只测 happy path；资源泄漏通常出现在失败和中断。
- 不允许没写实现体的 fake 方法静默返回空字符串、空数组或成功结果。
- 不在单测里连真实容器验证连通性；真实 provider 行为归 E2E 沙箱仓库。
