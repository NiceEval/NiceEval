# Sandbox 实例、伴随资源与生命周期

一条 eval 声明所需的任务条件，provider 据此启动主 Sandbox 实例和全部伴随资源，并返回可选能力句柄。
这些对象共享身份、证据与 finalizer，并同时接受留存或销毁。本页定义从声明到这些对象的完整契约；provider 的实现要点见 [Architecture](architecture.md)，使用侧 API 见 [Library](library.md)。

```text
Eval 或 Experiment 的 template-bearing layer
 → template 绑定的 Provider planner
 → provider-specific SandboxCase 构建产物并启动运行实例
 → 主 Sandbox 实例 + 可选能力句柄 + 伴随资源
 → 现有 Agent / Eval / `assertions.evaluate` 生命周期
 → provider planner 采证、留存或同时销毁
```

template 由具体 factory 声明并同时选定 Provider;哪一侧带 template 由配对决定,规则见 [Sandbox Layer](layers.md)。
NiceEval 不承诺同一道题自动跨 Provider 迁移:项目自己裁定两份实现是否可比,Record 里保存实际 case 身份供对账。

## 主 Sandbox 不变量

每次启动只返回**唯一一个主 `Sandbox` 实例**。
Agent、`test(t)` 的命令、文件上传、workdir、变更分类账与 diff 观察同一个执行空间——这条不变量对所有 provider 成立,没有例外。

单容器 case 里主 Sandbox 就是那个容器或微 VM。
Compose case 里主 Sandbox 是 `workspaceService` 对应的容器。
云 provider 在 VM / Pod 内启动 Compose 时,返回的 Sandbox 必须把所有命令和文件操作代理进 main 容器;外层 VM 只承载主容器与伴随服务,不能冒充 Agent 的执行空间。

额外能力不进 `Sandbox` 接口,由 case 在创建时附带穷尽的能力句柄。运行期 materialize 结果为:

```typescript
interface MaterializedSandboxCase {
  readonly sandbox: Sandbox;
  readonly group: SandboxResourceGroup;
  readonly services?: ServiceController;
  readonly retention?: SandboxRetention;
}

interface SandboxResourceGroup {
  /** 当前进程内整组停止；成功、失败、中断都由 Case finalizer 调用。 */
  stop(): Promise<void>;
}

type DetachedSandboxState = "alive" | "dormant" | "partial" | "missing";
```

服务控制与留存是两个正交能力:

```typescript
interface ServiceController {
  exec(service: string, command: string[]): Promise<CommandResult>;
  collectLogs(service: string): Promise<Buffer>;
  stop(service: string): Promise<void>;
}

interface SandboxRetention {
  /** suspend 成功后写入注册表、可跨进程恢复的主实例及伴随资源定位。 */
  readonly entry: SandboxGroupEntry;
  suspend(): Promise<void>;
}

interface DetachedSandboxRetention {
  inspect(entry: SandboxGroupEntry): Promise<DetachedSandboxState>;
  wake(entry: SandboxGroupEntry): Promise<MaterializedSandboxCase>;
  suspend(entry: SandboxGroupEntry): Promise<void>;
  destroy(entry: SandboxGroupEntry): Promise<void>;
}
```

Runner、评分与报告不按 provider 名分支;需要逐服务采证或控制时检查 `services` 能力,普通单 Sandbox eval 完全不接触这层。
`retention` 负责本进程把运行中的主实例及伴随资源提交为留存现场；`DetachedSandboxRetention` 是 CLI 跨进程 inspect / wake / suspend / destroy 的 provider 通道。`wake` 表示从任意 provider 的 dormant 状态恢复成活动实例，不暗示原进程对象可原地 `resume()`。
以后 GPU、动态网络策略或整组 checkpoint 也按独立能力扩展,不合并成一个「高级 Sandbox」布尔值，更不挂 `sandbox.suspend?` 这类隐藏成员。

## 声明形态:template factory 一次到位

Sandbox 声明只有一种一等写法:具体 factory 构造 template-bearing layer,起点、Provider 与主执行空间在同一处声明。
没有 profile 注册表,也没有按 source kind 登记的表:factory 属于 Provider 包,支持声明与实现不能在两个调用点分离。

一道 eval 自己拥有 Compose 与 fixture 时,在目录入口 `eval.ts` 里直接声明:

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
export default defineEval({
  sandbox: dockerComposeSandbox({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
    build: "on-demand",
  }),
  async test(t) { /* send 后直接用普通 Sandbox API 上传并跑测 */ },
});
```

多条 eval 或多个 Experiment 共用同一起点时,把 factory 调用抽成普通 TypeScript 函数:

```typescript
// evals/shared/tb-sheets.ts
export const tbSheets = () =>
  e2bSandbox({ template: "acme/tb-sheets-v5" });
```

不同 factory 的构建结果不要求结构同构,只需兑现同一条 eval 依赖的外部行为:任务依赖在场、主 Sandbox 可操作、测试所需服务可达、判分时 Sandbox 仍活着。
factory 参数是 provider 原生纯数据;判别键组合非法(如同时给 `template` 与 `build`)在构造期报错,一次穷举。
Provider 无法承诺的选项不进公共类型:Docker 的 build args 与 target stage 只出现在 Docker factory 上。

### 缺失与不可用分开判

- 配对两方都没有 template,或两方都有:link 期 `sandbox.template-missing` / `sandbox.template-conflict`,全矩阵聚合,零 Sandbox 创建。
- 声明合法、但目标平台、能力或 locator 在只读 physical planning 不可用:聚合报错,整个 Run 零资源失败;作者用 selector 显式排除该组合,Runner 不自动 `skipped`。

两条路都不自动把 Compose 翻译成近似替代,也不回退到默认单 Sandbox——静默降级跑十分钟得到的假 `failed` 比显式报错贵得多。

## 完整 case 目录

五类 case 都有完整义务与独立验收,不是只留扩展点:

| Case | 声明出处 | 主 Sandbox | 伴随资源 | 第一责任方 |
|---|---|---|---|---|
| 预制单 Sandbox | provider 起点构建结果(image / template / snapshot) | 该实例 | 无 | 对应 provider |
| 按需构建单 Sandbox | Dockerfile / OCI context | 构建结果实例 | 无 | 声明支持构建的 provider |
| Docker Compose | Compose + overlay | `workspaceService` 容器 | 同项目 services / network | Docker provider |
| 云端 Compose | Compose + provider 配置 | main 容器 | DinD、Pod 或原生组网 | 声明支持的云 provider |
| 自定义 case | 用户纯数据身份 + materializer | 用户返回的 Sandbox | 用户句柄 | 自定义 provider |

「provider-specific」不是少做契约:每一种公开 case 都要给齐启动、就绪、Agent 可见面、判分、证据、指纹、收尾与留存故事,只是不把不同 image、template、snapshot 或 Compose 实现伪装成同一种实现。

## BuildKey 与 CaseKey:两个身份各管一件事

规划期在任何携带决策之前,为每个待构建结果计算 `BuildKey`:

```text
BuildKey
 = builder kind + builder revision + target platform
 + Dockerfile bytes
 + .dockerignore 求值后的 build context 内容
 + build args 的非敏感解析值
 + 多阶段 Dockerfile 的 target stage
 + FROM 的稳定声明投影(已 pin 时为 digest,未 pin 时为 `unresolved:<ref>`)
```

target platform 是构建事实,不是一个写在代码里的默认值,并且**逐服务求值**,优先级从声明到探测:

1. 服务的 Compose 声明最优先:service 级 `platform`,或单元素 `build.platforms`;
2. 没有声明的服务用调用方显式指定值;
3. 两者都没有才从构建执行侧探测(Docker 取 daemon 的 os / arch)。

逐服务的有效平台进入该服务自己的 BuildKey,并同时传给构建执行,构出来的镜像架构与身份里写的架构永远同一个。
声明了平台的服务因此在任何宿主上身份稳定;未声明的服务在 arm64 宿主与 amd64 宿主拿到不同 BuildKey,两台机器不会对同一道题互认不可比的结果。
多元素 `build.platforms` 是发布场景的多平台矩阵,一个 BuildKey 只对应一种架构的构建结果,这类声明在规划期直接报错拒绝,不挑其中一个平台近似执行。

一个 Compose case 可以有零个、一个或多个 BuildKey:现场 build 的服务各一个,仅引用 `postgres:15` 的服务没有 BuildKey,登记其声明的 image ref；可取得的实际 digest 是创建期 provider observation。
构建结果另有 provider 原生 locator(Docker image digest、E2B template id)。
BuildKey 回答「为什么应该得到同一构建结果」,locator 回答「本次从哪里启动」。前者参与 planning 与 fingerprint；后者只服务 materialize 或留存注册表，不建立 Sandbox 专属的可携带事实。

完整 Sandbox 另算 `CaseKey`:

```text
CaseKey
 = case kind + materializer revision
 + Compose / overlay bytes
 + 所有 BuildKey
 + 无 build 的 service 的声明 image ref(已 pin 时含 digest,未 pin 时是原始 tag 文本;不是本地 daemon 解析出的实际 digest)
 + 相对 bind mount 源文件或目录内容
 + env_file / config / secret 的非敏感内容
 + 影响主执行空间、网络与就绪语义的规范化 case 参数
```

**BuildKey 负责构建结果复用,CaseKey 负责完整 attempt 运行身份与 fingerprint。**

当声明包含 [Sandbox Deployment](../../roadmap/sandbox-materialization/deployment/README.md) 时，identity 先按 immutable input → DeploymentBaseKey → DeploymentKey 求值。最终 CaseKey 再包含 DeploymentKey 与经过身份查找的 manifest digest。

cache policy、hit/miss、entry、generation、locator 与 lease 不进入 CaseKey。因此同一内容不会因本机缓存冷热而失去可比性。
只挂进 sidecar 的脚本改动不触发 client 镜像重建,但改变 CaseKey、作废旧结果。
逐 attempt 的容器名、临时目录和随机 project name 由 Provider 生成,不进 CaseKey，也不成为 portable Record identity。创建命令、计时与诊断需要可观察时，按其内容进入 Observability。

作者不能用 `container_name` 固定任一 service 的容器名；这会绕开受管 project namespace,让并发 Case 争用同一个宿主资源。
Agent 身份与 Sandbox 实例身份正交进入指纹(见 [Adapters · Agent Ensure](../adapters/architecture/agent-ensure.md)),因此同一份任务构建结果可以被多个 Agent experiment 共用,不要求为每个「题目 × Agent」组合构建 image 或 template。

Dockerfile provider 对内置 staged Agent 另有按需派生镜像缓存,但不改变上面的任务身份语义:

- 任务 `BuildKey` / `niceeval-build` 永远不含 Agent;派生身份只在 DockerfileProviderPlan 的运行 materialize 阶段计算。
- 只有内置 `createNpmCliInstaller()` 产生并明确标记为 cache-safe 的 staged installer 可以 opt in;其它 installer 走普通 task image 路径。
- 派生 key 由不可变 task image locator 或 digest、目标平台、ensure / installer 的稳定 identity 与安装 mode、以及派生 materializer revision 组成,不读取 `prepare()`、credentials 或 Agent setup。
- 派生 key 命中时跨 Run 先做 Docker image inspect。同 key 在进程内 single-flight。
- miss 时从干净 task image 创建临时 Docker sandbox。
- 临时 sandbox 照常执行 Agent ensure、staged install 与复检。
- 只提交临时 sandbox 为 `niceeval-agent:<derived-key 前 32 位>`，随后销毁它。attempt 容器绝不作为派生镜像提交对象。
- attempt 从派生 locator 启动，但仍执行正常 `runAgentEnsure` 并写入 探测 hit。
- 其它 provider 或不满足 opt-in 条件时直接回落 task image。

身份计算发生在携带决策之前。
这一步就是 Provider physical planning:

- Dockerfile factory 读取 `.dockerignore` 求值后的 context，产生单个 BuildKey。
- Compose factory 读取 Compose bytes，为每个 build service 产生 BuildKey。
- 安全摘要进 pair plan / fingerprint；context 路径、文件正文与 credential env 值不落盘。
- 规划后输入若变化，构建收集期会拒绝 key 不一致的 Run，不用新内容冒充旧计划。
浮动 image tag 若 provider 无法换成 digest,仍把原始 tag 作为身份声明；可以运行并写入 tag 与实际事实，但同名 tag 后来指向别的内容时不会自动作废旧结果。
同理，未 pin 的 `FROM`、Compose image / `FROM`、checkout 浮动 ref 与 opaque provider callback 的外部变化都需要作者提升 revision、改变声明，或使用 `--rerun all`。
凭据值不落盘、不进身份:凭据轮换不改变运行时语义时只写入引用名;凭据同时选择了不同租户、数据集或权限面时,用户必须提供非敏感 `revision` 进入身份,不靠 secret 值自动推断。

身份只收声明,不收本地 daemon 的易变求值状态——`docker inspect` 等查询只作为受管 command 的 Observability 结果，永不回填进 BuildKey / CaseKey。
同一份声明因此在两次独立规划之间(如 accept 后立即 `--dry`)必须算出相同身份,不随宿主机上并行的 docker 构建或拉取漂移。

身份求值是 fingerprint 的输入，不另设 provider carry eligibility 状态；未 pin 或未登记的值可以用原始声明或 opaque marker 表达，变化不会被自动观察。

## Run 级构建协调:共享准备的预算与调度

构建协调按本次仍需 fresh 执行的 attempt 所引用的 BuildKey 分组:

1. 先做携带规划;全部命中时不为查看旧结果而构建。
2. 查询 provider 原生 cache 或本地 build registry。
3. 同 key 只允许一个 builder,single-flight 等待者不重复上传 context 或创建 template。
4. cache miss 才调用 provider 原生构建 API;成功后以 BuildKey 登记 locator,再放行依赖它的 attempt。放行逐 key 发生:一条 attempt 只等自己引用的那几个 key,不等同批其它 key 收工,不引用任何 BuildKey 的 attempt 从第一秒就可派发。
5. 瞬时构建失败(基础镜像拉取限流、传输层中断)由 builder 按 [Provisioning 的性质分类](architecture.md#provisioning-失败与重试)指数退避重试、封顶次数。构建结果是镜像与 template,没有计费实例的泄漏面,歧义类失败同样可重试——一次镜像拉取的 EOF 不该让整批依赖该 key 的 Attempt 形成 `errored` Verdict。
6. 重试耗尽或确定性构建失败（构建定义错误、基础镜像不存在）按共享该 key 的范围止损。
   失败的 BuildKey 只执行一次；每个依赖它、本应 fresh 执行的 Slot 保持 `not-dispatched`，不制造 Attempt。
   Runner 在既有 Run-owned Observability diagnostics 中为这些 Slot 保存同一 shared failure identity；Analysis
   据此显示 slot outcome `errored`。历史 Record 没有采集该诊断时只保留 membership，不反推错误。

预算分两层,口径不混:

- **Run 级共享准备**:BuildKey 构建、共享拉取或发布受独立构建并发、逐 key timeout、全局准备上限和 Invocation abort 约束,不占 attempt 并发位。构建并发由 `maxBuildConcurrency` / `--max-build-concurrency` 控制，默认 2；它与 `maxConcurrency` / `--max-concurrency` 正交。
- **attempt 级启动**:从 image / template / snapshot 启动主 Sandbox 实例和伴随资源、等待服务 ready;Agent Ensure、执行与评分共享同一个 attempt 并发位和 deadline。attempt deadline 从拿到构建结果并开始启动 Sandbox 时起算。

共享构建不属于任一 attempt,不计入任何 attempt 的 `executionMs`;一次十分钟的冷构建在整份 Record 里只出现一次时间。
构建命令、计时与失败诊断都由 Run-owned Observability 收口；用于解释构建输入的源码 closure 归 Sources，需要保留的大型构建输出归 Artifacts。
每个 BuildKey 是一个可并发 activity 实例,内部可挂 `provider.image.pull`、`provider.build.execute` 等开放子 key。
六族运行事实的 exact durable shape 只由 [Record Architecture](../record/architecture.md) 定义。

这个前置阶段不是无预算后台工作:Ctrl+C 停止新构建并调用 provider 的 build cancellation;无法取消的远端 build 进入可核对 registry,后续按 provider locator 认领或销毁。
不依赖失败 BuildKey 的 attempt 继续执行,除非失败分类触发 eval / experiment scope 止损;carried attempt 不因查看历史结果触发构建,也不引用本 Run 不存在的 build。

## Docker Compose case

Docker provider 直接把任务 Compose 当原生运行时输入,不先编译成 NiceEval 的 services 词汇。
NiceEval 只生成必要的 overlay:

- 标记或补出 `workspaceService`;
- 注入 attempt 身份、受管目录与凭据引用;
- 应用资源上限和网络策略;
- 为收尾、孤儿核对与留存写 project label。

启动前先按 BuildKey 执行 `docker compose build`,命中 BuildKit cache 时只做增量核对;随后 `docker compose up --detach --wait`。
Compose 自己处理 `depends_on`、healthcheck、网络 DNS、`extra_hosts`、volume 与逐服务构建。


未知 Compose 字段不因 NiceEval parser 没见过就拒绝。
真正破坏核心不变量的字段由 Docker case 明确列黑名单；错误必须在 physical planning 点名字段与理由,早于携带、构建和资源创建。

黑名单包含以下声明：

- 让 main 容器脱离受管网络、替换受管 workdir,或让任一 service 挂载 Docker socket；
- 为任一 service 声明固定 `container_name`；
- 让非 `external` 的 network、volume、config 或 secret 使用不随 Compose project 变化的全局名称；
- 顶层 `include`,以及任意 `services.*.extends.file`。

命名空间检查以 Compose 合成后的有效模型为准,涵盖同文件 anchor、merge、插值与 service extends。
Provider 用两个不同的哨兵 project 求值同一份 file 与 env；受管资源的有效名称必须在两份模型中分别按 `<project>_<logical-key>` 变化。

完整模型只驻留规划内存,不落盘、不进入日志或错误正文,避免展开后的 credential env 值泄漏。
无法取得有效模型或解码其 JSON 时规划失败,不能跳过检查。

`external: true` 明确表示资源不归本 Case 创建和回收,因此保留其外部名称。
Compose 的第二文件入口不属于当前 CaseKey 的输入闭包；`include` 与任意 `extends.file` 必须拒绝,不能读取后仍用主文件身份携带结果。同文件复用用 anchor、merge 或不带 `file` 的 service extends。

`dns`、`extra_hosts`、自定义 networks 与 sidecar 隔离可以直接构成题目语义,Docker case 不把它们归一化掉。
Agent 只能进入 main 容器;sidecar 文件系统只经题目网络交互或受控的判分采证接口可见——把 sidecar 合并进主 Sandbox 会改变题目,不属于合法降级。

主容器进入 ready 后才交给 Agent;判分完成前整组保持存活。
任一必需服务提前退出时，Attempt 形成 `errored` Verdict，并附服务状态与日志的 Observability，不折叠成 Agent 行为的 `failed` Verdict。
收尾按 case 自己的资源句柄执行 `compose down`;部分启动、中断与超时同样走整组 finalizer。

逐服务日志由 `ServiceController` 取得并按有界 command / diagnostics 进入 Observability；需要保留的大型具类型捕获才进入 Artifacts。Artifact 声明只引用主 Sandbox 时所有 provider 都能运行,引用 sidecar 时启动期要求 `services` 能力并校验服务名存在。

## 云端 Compose case

云 provider 可以选择自己的完整实现,不要求复制 Docker provider 的进程结构:

- **DinD**:在云 Sandbox 内启动 daemon 与 Compose,主容器包装成返回的 Sandbox;外层 template 只预装 daemon、Compose 与共享基础 cache,不预烘每一道题。
- **Pod**:一个 Pod 里 main + sidecars,由 provider API 实现逐容器 exec、文件和日志。
- **原生组网**:多个实例接入 provider 私网,由 materializer 建立稳定服务名并保存网络与实例定位。

三种实现都必须满足相同的结果不变量:

1. Agent 与 `test(t)` 观察同一个主文件系统和网络视角。
2. 服务名在 Agent 与校验命令中定位一致。
3. 服务 ready 后才进入 Agent 生命周期。
4. 判分结束前服务存活;异常退出得到基建错误和证据。
5. 成功、失败、中断与超时都能同时回收主实例和伴随资源。

实现若只能启动多实例、却不能让文件 API 指向 main 执行空间,就没有完成该 case,不能只开一个 `services` 布尔位。
把依赖 DNS、`extra_hosts` 或 sidecar 文件隔离的题改成单 template 不算支持——运行条件变化已经破坏题目判据。

## 自定义 case

自定义 Provider 连同自己的 template factory 与 planner 一起导出。
每个自定义 case 必须给出纯数据身份与 materializer:

```typescript
import { Effect } from "effect";

defineSandboxCase({
  identity: {
    kind: "kubernetes",
    cluster: "eval-prod",
    manifestDigest: "sha256:...",
  },
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  services: { _tag: "Supported" },
  materialize: (ctx) => Effect.succeed({
    sandbox: mainPodSandbox,
    group: namespaceResourceGroup,
    services: { _tag: "Available", value: podServiceController },
  }),
});
```

约束:

- `identity` 必须可序列化;函数体不参与自动哈希，身份声明进入 fingerprint；需要改变语义时提升声明或 revision，不能用函数名或 `toString()` 冒充运行指纹。
- `services` 与 `materialize` 结果中的 services 都是完整 ADT/必填值。
  不用 optional 字段表示领域状态；`materialize` 返回 typed Effect。
- 声明了某项能力就承担对应完整契约测试。
- 自定义 Sandbox 定义的公开扩展面当前只允许主实例、伴随资源与 `services`；不能为 `defineSandboxCase` callback 声明跨进程留存，因为函数本身没有可发现的 provider identity 与 detached 实现。`--keep-sandbox` 与自定义 Sandbox 定义在创建前报错。未来若开放 provider plugin，必须先让 plugin 提供稳定 identity 与 `DetachedSandboxRetention`，不能仅加一个布尔 capability。

## 错误归属:五类互不冒充

| 失败点 | 结果 | 归属 |
|---|---|---|
| template 缺失、冲突或 case 声明非法 | link 期配置错误 | 一次穷举报错,零 Sandbox 创建 |
| 声明合法但平台、能力或 locator 不可用 | physical planning 聚合错误 | 整个 Run 零资源失败;作者用 selector 显式排除 |
| 共享构建失败 | 依赖它的 Attempt 形成 `errored` Verdict | 引用 Run-owned Observability diagnostic；同一 owner 的 timing 读出归属 |
| Sandbox 启动、ready、服务中途退出 | Attempt 形成 `errored` Verdict | Attempt 运行归属,附服务状态、命令与 diagnostics 的 Observability |
| Agent Ensure 失败 | Attempt 形成 `errored` Verdict | `agent.ensure` 归属(见 [Agent Ensure](../adapters/architecture/agent-ensure.md)) |

Agent 完成任务但断言未达标时，才形成 `failed` Verdict。
每个 case 至少产出创建与 ready 的 command、timing 与 diagnostics；它们归 Observability。声明 `services` 能力后还必须产出逐服务状态、失败日志与 ready timing；大型具类型日志归 Artifacts。provider locator、容器名与可 detached 操作的句柄只留在运行期或留存注册表。
证据字段是中性的,采集手段留在 provider。

## 收尾、留存与注册表

运行期以主 Sandbox 作为 Agent 的执行基准,但 cleanup callback 和留存同时作用于 provider 返回的**主实例及伴随资源**。
注册表不硬编码 `services[]`、`network` 或 Kubernetes namespace 字段,只存:

```typescript
interface SandboxGroupEntry {
  provider: string;
  profile: string;
  primary: SandboxLocator;
  resources: ProviderLocator;
  state: "alive" | "dormant" | "partial";
}
```

`resources` 是 provider 自己可序列化、可 detached stop 的定位数据。
`sandbox enter` 仍进入 `primary`;`sandbox stop` 把整组交回对应 provider 销毁。
provider 只返回 primary 时没有伴随资源,现有行为是新模型的严格子集;单实例留存的注册表纪律与各 provider 的休眠语义见 [Architecture · 留存与注册表](architecture.md#留存keep与注册表)。

Group keep 是独立能力:支持者必须能整组 suspend / wake、恢复后重过 ready 门、失败时保留可再次销毁的注册项。
只暂停主 Sandbox、让 sidecar 继续运行或丢失的实现不得声明。

## 动态泄漏检查:本地上传与 Agent 可见 closure

folder eval 的测试文件与构建输入共址时，materializer 与普通上传共同给出泄漏证据:

- materializer 登记全部 build context 经 `.dockerignore` / filtered context 求值后的实际 closure，以及 Agent 可达 bind mounts；需要在已发布 Record 中解释它时，closure 归 Sources。
- `test(t)` 中的普通本地上传登记 source tree 与内容摘要，并按同一 Sources 边界交叉比对。
- 判定封口前交叉比对两份输入；send 区间外才上传的测试若已在 Agent 可见 closure 中，写入 Observability diagnostic 并形成本次 Attempt 的 `errored` Verdict。
- 后续运行可用历史 transfer manifest 在启动 Agent 前预检；首次运行只能事后拒绝结果，不能宣称阻止了暴露。
- 修法是移出 context、写进 `.dockerignore`，或让 materializer 生成 filtered context；过滤规则自身进入 BuildKey。

需要保密时必须用物理隔离或 filtered context，不能把动态检查当保密边界。
完整规则见 [Eval · 本地测试文件](../eval/use-case/criteria-files.md)。

## Provider 能力矩阵

每个 provider 声明自己支持的 case 集合;「不同 provider 有不同 case 集合」是诚实的能力边界,不是 core 不通用:

| provider | 预制单 Sandbox | 按需构建单 Sandbox | Compose |
|---|---|---|---|
| Docker | image | Dockerfile / context | 原生 Compose case |
| E2B | template | 单 Dockerfile 构建成内容寻址 template | 不声明;兑现 DinD 或原生组网全部义务并通过真机契约测试后才开放 |
| Vercel Sandbox | snapshot | 不声明 | 不声明 |

云 provider 不因为「是完整 Linux VM」就自动支持云端 Compose；未通过契约测试就不声明。selector 应在运行前排除不支持的配对；若仍选中，physical planning 聚合报错并保持整个 Run 零资源，而不是把配置错误记成 `skipped`。
没有声明 Compose 能力的 provider 仍完整支持单 Sandbox 实例；外部编排继续作为 provider 无对应实现时的用户侧退路(见 [Library · 沙箱预置放哪](library.md#沙箱预置放哪))。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— provider 选择、生命周期 Hook、自定义 provider。
- [Architecture](architecture.md) —— 生命周期时序、留存注册表、孤儿核对、重试。
- [Record Architecture](../record/architecture.md) —— 五个固定 family 的 owner、closure 与 maintenance 边界。
- [Adapters · Agent Ensure](../adapters/architecture/agent-ensure.md) —— case 产出主 Sandbox 之后,Agent 怎样检查与安装。
- [Experiments · 缓存与携带](../experiments/cache.md) —— CaseKey 怎样进入指纹与携带门。
