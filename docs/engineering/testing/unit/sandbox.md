# Sandbox 怎么测

契约来源：

- [Sandbox](../../../feature/sandbox/README.md)
- [Sandbox Layer](../../../feature/sandbox/layers.md)
- [三方准备时序](../../../feature/sandbox/lifecycle.md)
- [内置 prepare 命令](../../../feature/sandbox/prepare-commands.md)
- [Architecture](../../../feature/sandbox/architecture.md)
- [Sandbox Case](../../../feature/sandbox/case.md)
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

- **生命周期与资源释放**：失败与中断路径的清理和成功路径同等重要。

  - 调用链固定顺序:template owner 命令先、另一 owner 次、`agent.ensure` 最后;省略 `sandbox` 字段归一成空 command-only layer。
  - modern `SandboxLayer.setup()` / `.teardown()` 只在物理实例首尾运行：fresh 各一次，reuse 每 lane 一次；setup 正序、teardown 逆序，setup 失败仍完整 teardown，单个 teardown 失败记 diagnostic 不阻止其余 hook 与 provider stop。纯 Experiment-owned hook 可跨 eval 共池，Eval-owned hook 必须隔离。
  - prepare 抛错时已登记 cleanup 逆序执行,finalizer 与 stop 走 finally;prepare 抛错计 errored,cleanup 报错只记诊断,逐段清理超时收束成诊断。
  - layer 的 `prepare()` 追加序与 kind 品牌不可变:command-only 变不成 template-bearing,template-bearing 追加不了第二起点。
  - `onCleanup()` 只在取得资源后登记、按全局准备顺序逆序执行;创建后被终止属 lifecycle failure 不进 IO 重试。
  - Direct Agent 搭配 SandboxLayer 报 link 错误;command 的窄上下文没有 `stop()` 也没有 Provider-native SDK。
- **路径规则**：沙箱侧相对/绝对/省略三态解析、`../` 规范化与逃逸拒绝、无 shell 变量展开、本地侧按 eval 定义文件目录解析——适合表驱动，每个 case 指向一条允许或拒绝语义。`Sandbox` wrapper 只转发正式接口与可选 `appendLog`；留存走 `MaterializedSandboxCase.retention`，不得通过接口外 `sandbox.suspend` 动态探测。
- **三个操作视图一套语义**：完整 `Sandbox`、`EvalSandbox` 与 `SandboxCommandTarget` 的 `runCommand` / `runShell` / 文本 / 字节方法逐个同签名同结果；差异只在宿主传输、diff、Case lifecycle 与登记内容能力是否存在。同名方法在 layer target 非零抛错、在 `t.sandbox` 返回结果的旧分叉必须被区分力场景抓住。
- **命令执行**：argv 传参不经 shell（含分号/美元符的参数原样送达——参数透传能发现错误的 shell 拼接，断言 mock 被调一次不能）；`runCommand` / `runShell` 非零返回 CommandResult，`runCommandOrThrow` / `runShellOrThrow` 才抛携带完整结果的 exit error；env 叠加不清空；root 的映射与不支持时报错；`timeoutMs` / signal 合并；执行入口永不被隐式重试。
- **命令树寿命**：正常命令结束后关闭 transport / PTY 不杀命令有意启动的服务；timeout、取消、Attempt interruption 与 Agent runtime cancellation 必须在 Promise settle 前确认受管命令树终止，不能只关输出流。Provider 无法精确终止时停止 Sandbox，且该实例不得再进 reuse / keep。逻辑 send 的窗口跨全部重试，ledger 与 retryAttempts 记账、driver 静止都发生在 settle 前。
- **失败命令证据包装**：四个公开 `run*` 方法最外层调用非零退出时，先登记一次 `FailedCommandEvidence`，再把结果交还调用方。
  证据与同一次 timing command node 共用 id；成功命令不登记输出，provider 内部转调不重复。
  调用方处理非零结果并继续也不撤销证据。stdout/stderr 保留原换行与首部根因，不能先 tail-only 再交 writer。
  fixture 必须让 Eval 随后把错误 `.slice(-500)`，仍能从登记项读到前部根因，证明捕获时点正确。
- **命令证据的已知敏感值脱敏**：用合成 API key/header/env 值证明 provider 与运行时结果仍拿原值。
  `CommandResult.command`、timing、commands 输出、events/trace、retryAttempts、diagnostics 与最终 error 只含 `<redacted>`。
  替换发生在摘要截断前，重叠值最长优先；full、expand 与 JSON 的数据源不得保留原值。
  另有反例证明只写 `api_key=` 但没有显式 `sensitiveValues` 不触发猜测。
- **文件操作与 IO 重试**：Sandbox 内部只用 `readText` / `writeText` / `readBytes` / `writeBytes` / `pathExists`，`upload*` / `download*` 只做真实宿主传输；`Uint8Array` 字节完整往返，Buffer 只作结构兼容。只有幂等固定目标操作进默认重试；瞬时/非瞬时边界；`pathExists` 遇瞬时错误必须抛出不伪装 false；重试耗尽抛回原始错误链；目录传输重跑等价；`downloadDirectory` 与 `uploadDirectory` 对称的 `ignore` 和锚点语义。

  `registerSandboxContent()` / `putContent()` 必须逐层兑现登记目录的路径与字节。目标父目录由 root 创建时，非 root 的目录创建被拒绝也不能把嵌套树静默截成顶层文件。
- **Provisioning 失败与重试**：原生限流归类、回退瞬时分类器复用、可重试 kind 的退避与确定性错误零重试；退避期间归还并发槽位；有对账通道时先对账再重试、对账失败放弃并抛回原始错误、无通道时歧义类零重试；自定义 provider 不套用这层重试。
  相关裁决与踩坑见 memory 的[sandbox-provision-ratelimit-retry](../../../../memory/sandbox-provision-ratelimit-retry.md)、[e2b-provision-429-duplicate-sandbox](../../../../memory/e2b-provision-429-duplicate-sandbox.md)。
- **Provisioning 确定性死因的对外 scope 映射**：三档确定性配置死因（凭据缺失、权限不足、模板不存在）从 provider 原生错误形态（含跨 cause 链走查）的识别，以及识别后按[执行失败分类](../../../feature/error-classification/README.md)的结构化契约（`_tag` + `class`）附着到错误对象；按死因的配置解析域定档——凭据缺失、权限不足恒定档 `scope: "experiment"`（与 template owner 无关），模板不存在按 template owner 定档（Eval owner 定 `scope: "eval"`、Experiment owner 定 `scope: "experiment"`）；瞬时失败（拒绝类/歧义类）重试耗尽后不附带 scope，确定性死因未命中三档词表之一时同样不附带 scope。
- **diff 与结果断言**：分类账锚点与 send 窗口归因（环境生命周期 Hook、Eval Fixture、send 后校验写入都不进 Agent diff）；窗口标签与轮标签同枚 token、按等值匹配；默认排除与 ignore/include 的 glob 语义、nested repo 不静默吞改动；`noFailedShellCommands` 只看 Agent 自己的调用；延迟断言 finalize 时对最终 diff 求值。

  - Provider 支持 root command 时,ledger 能读取 mode `0311` 的任务文件建立锚点并导出。全部内部 Git shell 明确带 root 身份,workdir 的 owner / mode 不变。
  - Provider 不支持时仍能处理普通 workspace。遇到权限拒绝要点明能力边界与原路径,不能建议 `chmod` / `chown` 改掉题目条件。
- **导出预算与内容省略**：预算只数真正传输的文本字节。
  二进制与超 1 MiB 文本按 `elided` 记字节数、不占预算；编译产物型窗口因此整体放行，这一格在「按尺寸计」的旧口径下会红。
  纯文本传输字节越界仍报执行错误。
  `elided` 往返与派生视图各一格；被省略内容的读取按证据不可用报错，存在性与 `status` 断言照常成立。
- **template 配对与作者面**：`sandbox` 字段只接受 factory 产物,没有默认值、不自动探测。

  - 每个实际配对恰好一方 template-bearing:1×1 报 `sandbox.template-conflict`、0×0 报 `sandbox.template-missing`,全矩阵聚合、零 Provider I/O、零 Sandbox 创建。
  - 混合数据集：command-only Experiment 同时选择共享 `node24()` helper 的普通 Eval 与自带 Compose 的 Eval 时全部合法，仍是一份 Experiment。
    给 Experiment 加 template 后，对应配对明确 conflict，不允许 Eval override 或静默丢层。
  - 物理身份相同的两份 template 仍是 conflict;三个入口消费同一 linker,要有 `check`、`--dry` 与正常运行对同一非法矩阵给出同一结论的区分力场景。
  - pair key 用 tuple 编码并覆盖 id 自带分隔符的反例；同一 `(Experiment, Eval)` 重复出现走 typed failure，不能静默覆盖。
    linked pair 的 carry 只允许 `Eligible` 或带非空 reasons 的 `Blocked`，没有 boolean 与可选数组的矛盾组合。
  - 自定义 provider 连同 factory 直接调用、核心路径无 provider 名分支;`t.sandbox` 的错误反馈带 API 名与 agent 名,经管线不经 stdout。
  - ProviderModule binding：公开 plan 无私有 runtime input；伪造 plan 得到 typed binding error。
    build/materialize 均调用 factory 私绑的同一 typed Plan。
    core 中出现 adapter switch 或 runtime Schema decode 时测试必须失败。
  - Scope ownership：fresh materialization 的 Scope 在成功、失败和 interruption 三条路径都恰好释放一次。
    Managed release 与默认 stop 互斥，不得 double-stop。
- **官方 E2B coding-agent 模板契约**：Claude Code / Codex 继续继承各自的 E2B 官方模板，Bub 继续使用固定配方；三条配方都必须把运行用户的 npm global prefix 收敛为 `/usr/local`，并显式准备可写的 `/usr/local/bin` 与 `/usr/local/lib/node_modules`。
  结构测试读取 `Template.toJSON()` 证明这两步都存在；真实 build 对运行用户执行 prefix、PATH 与目录写权限自检。
  不能只测 Agent CLI 可执行——不同官方基线的 Node 安装位置恰好会让 CLI 自检通过而后续 `npm install -g` 整片失败。
- **官方基线 image / template 的版本与发布台账**：公共 E2B template 与 Docker image 的版本 tag 是 `<Agent 版本>-r<配方修订>`，版本位取自与 Adapter 运行时回退安装同一批的版本常量，niceeval 自身的版本不出现在 tag 里；同一个 Agent 在已发布的 provider 上共用同一个版本号。
  Docker 侧覆盖全部 `CodingAgentBaseline`；E2B 侧是子集（`E2BCodingAgent`），未进台账的 Agent 不导出 E2B 常量。
  导出的具名常量必须指向**已发布**的 image / template：E2B 侧逐 agent 与 `sandbox/e2b/published.json` 的台账逐字段核对（tag、name、台账记录的 Agent 版本与源码版本常量一致，bub 另核对安装指纹），版本常量走在发布前面时这一格红；唯一的放行方式是台账条目显式写下待发布的 tag（`supersededBy`），默不作声的分叉必须红——那正是「常量指着装了旧 Agent 的 image / template」而全绿的形态。
  Bub 的安装指纹要证明 `version` 与 `otelPlugin` 都参与：换任一个都换指纹（否则预装环境的 marker 会在配方已变时继续命中，装到上一代）。
  跨语言的同源值（`sandbox/docker/Dockerfile` 的 `ARG` 默认值、`bub-override.txt`、镜像里写死的 marker）不能导入 TypeScript，因此逐个与源码常量比对——漂移只在真实构建时才暴露，类型检查一次都拦不住。
  OpenClaw 的版本位是 calver（如 `2026.7.1-2`），tag 形如 `2026.7.1-2-r1`，守护正则必须覆盖这种形态，不能只认三段 semver。
- **Checkpoint**：打包/解压失败直接抛错不冒充成功，临时归档按 finally 清理。
- **Local provider**：仓库根解析与仓库外报错；只观察不还原（用户 git 状态不被触碰、stop 不删工作树）；不提权；与 keep 组合创建前报错。
- **Sandbox 复用**：
  - 配置：`sandboxReuse: true` 进入配置哈希，省略时每 Attempt 全新 Sandbox。
  - 重放：两层作者 `prepare()` 每 Attempt 重放,要有「第二条 Attempt 重新执行且 probe 命中快速返回」的区分力场景;`agent.ensure` 与 Agent runtime 每 Attempt 执行。
  - 重置：题间 reset 尊重排除清单，重置点仍是归因锚点。
  - 调度：覆盖 `maxConcurrency: 1`、并行复用、按需创建和派发前续期。
  - 寿命：覆盖 `lifetimeMs` 不足时更换、reset 失败淘汰和中途消失不静默重跑；E2B 的 bounded Attempt 未声明时以 deadline 加收尾预留创建，显式较短值在远端创建前失败。
  - 能力归属：`SandboxReuseCapability` 只能来自 Provider 实现。
    要有「provider 没有该能力 + `sandboxReuse: true` → 第一条 Attempt 派发前硬失败」的区分力场景。
    不允许任何通用记账层让它静默通过。
  - 调度事实：`sandbox.provider` / `sandboxId` / `reused` / `reuseSandbox` / `reuseOrdinal` 在租借时刻确定。
    Eval `setup` 失败与超时的 attempt 记录同样带全这些键。
    fixture 要造 setup 阶段失败的场景，断言字段在场。
  - 复用污染诊断：某实例承接序号 ≥ 2 的 Attempt 集中失败于同一阶段时产出运行级 diagnostic（点名实例、序号区间与阶段）；首承接失败或失败不聚集时不误报。
  - 组合：`--keep-sandbox` 与 `localSandbox()` 的互斥在创建前报错。
  - 结果：复用 Attempt 与普通 Attempt 同样按指纹携带；携带不创建 Sandbox，真实派发仍走复用生命周期。
- **孤儿核对与 prune**：创建期运行标识元数据的写入边界；孤儿三条件与 unverified 的保守判定；prune 的幂等、`--force` 语义与失败退出码。核对与销毁以资源组为单位：Compose case 的伴随容器与网络随主实例整组进 `list --orphans` 与 prune，要有「主实例已消失、只剩网络残留」仍被列出并收回的区分力场景。
- **留存(keep)登记项的 `expiresAt`**：按 provider 声明的保留期限计算——vercel 写 `keptAt` 加默认 Run 保留期(30 天),e2b(pause 官方契约无自然过期)与 docker(本地停驻,非远端保留期概念)都不写；`niceeval sandbox list` 的过期分支据登记项的 `expiresAt` 展示保留截止时刻。
- **Case retention 能力**：内置可发现 provider 的 materialize 结果有/无 `retention` 两格；有能力时 `entry` 与整组 suspend 原子提交，无能力时 `--keep-sandbox` 在创建前拒绝。`defineSandboxCase` callback 即使返回同名对象也不能声明 keep，因为缺稳定 provider plugin identity 与 detached 实现。`DetachedSandboxRetention` 的 inspect / wake / suspend / destroy 对单 Sandbox 与 Compose 资源组兑现同一协议。
- **detached 生命周期路由(`keep.ts`)**：`nativeEnterCommand`/`wakeDetached`/`suspendDetached`/`inspectDetached`/`destroyDetached`/`execInDetached` 三 provider 分支各自的正常路径与失败路径——mock 各自 SDK 模块(`dockerode`/`e2b`/`@vercel/sandbox`),不发真实请求。
  探测抛错必须归 `unknown`，只明确未找到才归 `expired`；vercel 销毁只吞明确 404。
  vercel 分支专门证明:唤醒走 `Sandbox.get({ name, resume: true })`(name 而非 sessionId,与官方 CLI/SDK 按 name 索引一致)、查状态与销毁走 `resume:false` 不产生唤醒副作用、销毁调用 `delete()` 而非 `stop()`(`stop()` 是可恢复的 suspend,不是永久销毁)；`detachedCapabilityGap` 对已知三 provider 返回 undefined、对未知 provider 名返回可展示的原因(供 CLI 报「不支持,原因」而不是逐条 `if (provider === …)`)。
- **`sandbox enter`/`history`/`diff` 的能力路由(`cli-commands.ts`)**：三条命令统一走"能力声明 gap 检查 → 唤醒 → 操作 → 回眠"路径,不含 provider 名分支——docker 与 e2b 各证明一次唤醒成功路径;interactive enter 的原生命令 spawn 失败(未装对应 CLI)现场保持 alive 并提示直连命令,不误判成功;条目旁 `.lease` 以 `wx` 原子占坑，竞争者拒绝并报 holder，TTL 接管后原持有者释放不得删掉后来者。
- **`list`/`history` 一次性面板接线到 `panel.ts`（`cli-commands.ts`）**：面板几何本身（宽度上限、截断优先级、CJK 量测……）由[Reports 的「面板几何」类别](reports.md#覆盖规范)覆盖，这里只证明两条命令真的把内容交给 `renderPanel` 而不是各自拼框字符——`history` 对着一段固定的 git 日志 fixture（anchor + 交替的 eval/agent 提交，逐提交 mock `git diff --name-status` 的文件改动）核对完整输出与 `docs/feature/sandbox/cli.md` 的框线示例逐字一致（含 `eval` 提交按「首次 = fixture / setup、之后 = post-send validation」分类、`agent` 提交的文件改动列表、下边框嵌最近一个窗口的 `diff --window` 命令）；`list` 核对启动时探测到的传输能力（`io.isTTY`/`columns`）经 `panelCapabilityOf` 正确转成 `renderPanel` 的 `mode`/`width`——非 TTY（未声明 `isTTY` 的既有测试默认场景）不产生任何框字符，`isTTY: true` 时产生可识别的框线字符。
- **sandbox case 五类**（[Sandbox Case](../../../feature/sandbox/case.md#完整-case-目录)）：

  - 预制单 Sandbox、按需构建单 Sandbox、Docker Compose、云端 Compose、自定义 case 各自给齐主 Sandbox、资源、身份、证据与清理。
  - 每类 case 只返回一个主 `Sandbox`；Agent、Eval、文件 API、workdir、分类账与 diff 观察同一执行空间。
  - 未声明能力的 Compose 不得静默降级成单 Sandbox；自定义 case 缺稳定纯数据 identity 时禁止携带。
- **command identity 与内置 prepare 命令**：

  - `command()` / `shell()` 的纯数据 identity 进入 fingerprint；直接传入的 callback 一律 opaque，该 Attempt `carryEligible = false`。prepare command identity 不进入同一 Run 的物理复用池键；要用两个 Eval 声明不同 prepare、但 Provider physical plan / Agent ensure / lifecycle owner 相同的场景，证明它们共用实例且每条命令在各自 Attempt 仍重放。
  - `defineSandboxCommand()` 的 id / revision / inputs 参与稳定身份;`registerSandboxContent()` 的 digest 折入 inputs。
  - `checkout()`:镜像按 `(repo, ref)` 键控,同一 Sandbox 第二次执行零网络。
    区分力场景是 mock 网络层后第二条 Attempt 不得发起 fetch;浮动 ref 记录解析出的 SHA,且该 Attempt 不参与跨 Run carry。
  - `installTool()`:probe 命中快速返回、未命中 install 后复检、复检仍未命中计 errored;`tool` / `identity` / probe / install 任一变化使旧命中失效。
  - `--dry` 复用成本视图:内置命令标检查命中型,普通 command(含作者自建 `defineSandboxCommand()`)标每题重放;fresh 模式不展示该视图。
- **BuildKey single-flight、失败向所有依赖项传播失败和预算**：

  - physical planning 产出的 ProviderPlan 必须已经携带闭合的 `build` 完成态。
    `None` 与 `Required` 都有确定 `caseKey`，`Required` 另有非空 `buildKeys`；该完成态进入 provider identity。
    构建收集只能执行并核验这些 key，不返回或重算 `caseKey`。
    Attempt 不保存 optional locator/case 字段。运行时 locator 是启动 Sandbox 的执行输入；locator key 或 Provider 返回的 Case 不吻合计划时，都走 typed drift failure。
  - 同 BuildKey 只允许一个 builder，等待者不重复上传 context。
  - 瞬时构建失败（拉取限流、传输层中断）按性质分类退避重试、封顶次数；重试耗尽才落确定性止损，确定性失败零重试。
    退避睡眠按注入的时长参数推进，不做真实等待；重试期间 abort 立即收束成 `cancelled`，不睡满封顶次数。
  - 逐 BuildKey 放行：某个 key 还在构建时，只依赖已就绪 key 的 attempt 与不引用任何 key 的 attempt 照常派发。
    要有「一个慢 key + 一条不依赖它的 eval」的区分力场景，断言那条 eval 在慢构建返回之前已经开跑——全局 barrier 的实现在这一格必红。
  - 目标平台是构建事实：探测到 arm64 的宿主与探测到 amd64 的宿主对同一份 Compose 算出不同 BuildKey，且构建执行拿到的平台与进 key 的值同源。
    要有「探测值 amd64 / arm64」的区分力场景，硬编码默认值的实现在这一格必红。
  - 确定性构建失败只执行一次；依赖该 key 的 fresh attempt 同得环境 `errored`，origin 指向同一 Run timing node。
  - 不依赖失败 key 的 attempt 继续执行。
  - Run 级共享准备有独立并发、逐 key timeout、全局准备上限与 abort，不占 attempt 并发位。
  - 共享构建时间只在 `RunMeta.timings` 记一次，不进任何 attempt 的 `executionMs`。
  - 完全携带、无需查询的 BuildKey 不触发构建，也不造假 provenance。
- **Compose 主空间、服务 ready、证据、整组清理与泄题门**：

  - `workspaceService`（或云端代理进 main）是唯一主 Sandbox；主容器 ready 后才进入 Agent。
  - 必需服务提前退出 → attempt `errored` 附服务状态与日志，不折叠成 Agent `failed`。
  - 成功、部分启动、中断、超时都走整组 finalizer，不留孤儿。
  - 黑名单只拒脱管网络、覆盖受管 workdir、挂载 Docker socket；其余 Compose 字段原样生效。
  - 动态泄漏检查：普通本地上传 source 与全部 build context、相对 bind mount closure 交叉检查，命中则 Attempt `errored`。
  - 过滤规则进入 BuildKey；历史 transfer manifest 可在后续运行启动 Agent 前预检，首次运行只保证不采信泄题结果。

## 不这样测

- 不在 Context 测试里重新实现一个会执行真实 shell 的 fake Sandbox。
- 不断言 Docker SDK、Vercel SDK 或 E2B SDK 的构造器本身工作。
- 不只测 happy path；资源泄漏通常出现在失败和中断。
- 不允许没写实现体的 fake 方法静默返回空字符串、空数组或成功结果。
- 不在单测里连真实容器验证连通性；真实 provider 行为归 E2E 沙箱仓库。
