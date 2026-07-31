# Sandbox Case —— 环境的完整物化单位

一条 eval 声明它要的任务环境,provider 把这份声明翻译成一个 **sandbox case**:从环境输入到主 Sandbox、伴随资源、身份、证据与清理的完整故事。
本页是 sandbox case 的单一契约入口;provider 的实现要点见 [Architecture](architecture.md),使用侧 API 见 [Library](library.md)。

```text
eval.environment(profile 或 folder-local source)
 → 当前 SandboxSpec 的 environments / materializers 两张表
 → provider-specific SandboxCase 物化
 → 主 Sandbox + 可选能力句柄 + 资源组
 → 现有 Agent / Eval / scoring 生命周期
 → case 自己采证、留存或整组销毁
```

Eval 只选择 environment,不选择 provider;同一个 profile 在不同 provider 可以映射到不同原生实现。
NiceEval 不承诺同一 profile 自动跨 provider 迁移:项目自己裁定两份实现是否可比,记录里保存实际 case 身份供对账。

## 主 Sandbox 不变量

每个 sandbox case 只返回**唯一一个主 `Sandbox`**。
Agent、`test(t)` 的命令、文件上传、workdir、变更分类账与 diff 观察同一个执行空间——这条不变量对所有 case 成立,没有例外。

单容器 case 里主 Sandbox 就是那个容器或微 VM。
Compose case 里主 Sandbox 是 `mainService` 对应的容器。
云 provider 在 VM / Pod 内启动 Compose 时,返回的 Sandbox 必须把所有命令和文件操作代理进 main 容器;外层 VM 只是物化宿主,不能冒充 Agent 的执行空间。

额外能力不进 `Sandbox` 接口,由 case 在创建时附带能力句柄。
第一期只有服务能力:

```typescript
interface ServiceController {
  exec(service: string, command: string[]): Promise<CommandResult>;
  collectLogs(service: string): Promise<Buffer>;
  stop(service: string): Promise<void>;
}
```

Runner、评分与报告不按 provider 名分支;需要逐服务采证或控制时检查 `services` 能力,普通单 Sandbox eval 完全不接触这层。
以后 GPU、动态网络策略或整组 checkpoint 也按独立能力扩展,不合并成一个「高级 Sandbox」布尔值。

## 配置形态:两张表,一个优先级

环境来源有两种同等的一等写法:

1. **共享 profile。**
   多条 eval 共用一个已命名环境时写字符串 id,由 SandboxSpec 的 `environments` 表按 profile 名映射成完整 case。
2. **folder-local source。**
   一道 eval 自己拥有 Dockerfile、Compose 与 fixture 时,在目录入口 `eval.ts` 里直接声明 sandbox source。
   eval 目录路径同时生成 eval id 与默认 profile id,不要求再去中央表手抄一遍。

两种写法在 SandboxSpec 上各有一个入口:`environments` 表按 profile 名映射完整 case;`materializers` 表按 source kind(如 `compose`、`dockerfile`)注册 folder-local 声明的物化器。
同一 profile 两处都命中时,显式 `environments` 表项优先——这就是 provider 用预建产物覆盖按需构建的口子。
内部都归一成「稳定 profile + provider-specific SandboxCase」,Runner 不按写法分支。

内置 case 的表值是 provider 原生纯数据,靠判别键区分,类型由 spec 工厂的参数类型给出;判别键组合非法(如同时给 `template` 与 `build`)在 spec 构造期报错,一次穷举:

```typescript
dockerSandbox({
  environments: {
    "tb-sheets": {
      compose: {
        file: "tasks/simple-sheets-put/docker-compose.yaml",
        mainService: "client",
      },
    },
  },
  materializers: { compose: dockerComposeMaterializer() },
});

e2bSandbox({
  environments: {
    "tb-sheets": { template: "acme/tb-sheets-v5" },
  },
});
```

这两项不要求结构同构,只需兑现同一条 eval 依赖的外部行为:任务依赖在场、主 Sandbox 可操作、测试所需服务可达、判分时环境仍活着。

folder-local 的中性 source 声明用 `composeSandbox`:

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
const environment = composeSandbox({
  file: new URL("docker-compose.yaml", import.meta.url),
  mainService: "client",
  build: "on-demand",
  executionUser: "image",
});

export default defineEval({
  environment,
  async test(t) { /* send 后上传同目录 verifier 再判分 */ },
});
```

`composeSandbox` 只声明 Compose source 与主执行空间,不选择 provider,也不承诺所有 provider 都能消费;能不能物化由当前 SandboxSpec 有无对应 materializer 决定。

### 两类缺失分开判

- eval 引用的 profile 键任何表都查不到、自己也没有 folder-local source:这是键名笔误的形状——启动期配置错误,一次穷举列出全部缺项,零 Sandbox 创建。
- 声明合法、但当前 provider 既无该 profile 的 `environments` 表项、也无该 source kind 的 materializer:这是能力缺失——该组合零成本计划期 `skipped`,skipReason 同时列 eval id、source kind 与可补的映射位置。
- 选中集合全部 `skipped` 时升级为启动期报错,不产出绿色空跑。

两条路都不自动把 Compose 翻译成近似环境,也不回退到默认单 Sandbox——静默降级跑十分钟得到的假 `failed` 比显式 `skipped` 贵得多。

## 完整 case 目录

五类 case 都有完整义务与独立验收,不是只留扩展点:

| Case | 声明来源 | 主 Sandbox | 伴随资源 | 第一责任方 |
|---|---|---|---|---|
| 预制单 Sandbox | provider 起点产物(image / template / snapshot) | 该实例 | 无 | 对应 provider |
| 按需构建单 Sandbox | Dockerfile / OCI context | 构建产物实例 | 无 | 声明支持构建的 provider |
| Docker Compose | Compose + overlay | `mainService` 容器 | 同项目 services / network | Docker provider |
| 云端 Compose | Compose + provider 配置 | main 容器 | DinD、Pod 或原生组网 | 声明支持的云 provider |
| 自定义 case | 用户纯数据身份 + materializer | 用户返回的 Sandbox | 用户句柄 | 自定义 provider |

「provider-specific」不是少做契约:每一种公开 case 都要给齐启动、就绪、Agent 可见面、判分、证据、指纹、清理与留存故事,只是不把不同底座伪装成同一种实现。

## BuildKey 与 CaseKey:两个身份各管一件事

规划期在任何携带决策之前,为每个待构建产物计算 `BuildKey`:

```text
BuildKey
 = builder kind + builder revision + target platform
 + Dockerfile bytes
 + .dockerignore 求值后的 build context 内容
 + build args 的非敏感解析值
 + FROM 解析后的 digest
```

target platform 是构建事实,不是一个写在代码里的默认值。
构建执行环境自己报出目标平台——Docker 取 daemon 的 os / arch,显式钉死时以钉死值为准;进入 BuildKey 的那个值同时钉给构建器,构出来的镜像架构与身份里写的架构永远同一个。
arm64 宿主上物化的题因此拿到与 amd64 宿主不同的 BuildKey,两台机器不会对同一道题算出相同 CaseKey、再让携带门互认不可比的结果。

一个 Compose case 可以有零个、一个或多个 BuildKey:现场 build 的服务各一个,仅引用 `postgres:15` 的服务没有 BuildKey,只记录解析后的 image digest。
构建结果另有 provider 原生 locator(Docker image digest、E2B template id)。
BuildKey 回答「为什么应该得到同一构建产物」,locator 回答「本次从哪里启动」,两者都进运行记录。

完整环境另算 `CaseKey`:

```text
CaseKey
 = case kind + materializer revision
 + Compose / overlay bytes
 + 所有 BuildKey
 + service image digest
 + 相对 bind mount 源文件或目录内容
 + env_file / config / secret 的非敏感内容
 + 影响主执行空间、网络与就绪语义的规范化 case 参数
```

**BuildKey 负责构建产物复用,CaseKey 负责完整 attempt 环境身份与携带门。**
只挂进 sidecar 的脚本改动不触发 client 镜像重建,但改变 CaseKey、作废旧结果;逐 attempt 的容器名、临时目录和随机 project name 不进 CaseKey,作为物化事实记录。
Agent 身份与 sandbox case 身份正交进入指纹(见 [Adapters · Agent Ensure](../adapters/architecture/agent-ensure.md)),因此同一份任务构建产物可以被多个 Agent experiment 共用,不产生「题目 × Agent」的制品矩阵。

身份解析发生在携带决策之前。
浮动 image tag 若 provider 不能解析成 digest,该环境的旧结果不参与携带;可以运行并记录 tag 与实际事实,但不能假装两次环境可比。
凭据值不落盘、不进身份:凭据轮换不改变环境语义时只记录引用名;凭据同时选择了不同租户、数据集或权限面时,用户必须提供非敏感 `revision` 进入身份,不靠 secret 值自动推断。

## Run 级构建协调:共享准备的预算与调度

构建协调按本次仍需 fresh 执行的 attempt 所引用的 BuildKey 分组:

1. 先做携带规划;全部命中的环境不为查看旧结果而构建。
2. 查询 provider 原生 cache 或本地 build registry。
3. 同 key 只允许一个 builder,single-flight 等待者不重复上传 context 或创建 template。
4. cache miss 才调用 provider 原生构建 API;成功后以 BuildKey 登记 locator,再放行依赖它的 attempt。放行逐 key 发生:一条 attempt 只等自己引用的那几个 key,不等同批其它 key 收工,不引用任何 BuildKey 的 attempt 从第一秒就可派发。
5. 瞬时构建失败(基线镜像拉取限流、传输层中断)由 builder 按 [Provisioning 的性质分类](architecture.md#provisioning-失败与重试)指数退避重试、封顶次数。构建产物是镜像与 template,没有计费实例的泄漏面,歧义类失败同样可重试——一次镜像拉取的 EOF 不该把整批依赖该 key 的 attempt 打成 `errored`。
6. 重试耗尽或确定性构建失败(构建定义错误、基线镜像不存在)按共享该 key 的范围止损:失败的 BuildKey 只执行一次,所有依赖它、本应 fresh 执行的 attempt 得到同一环境 `errored`,origin 指向同一个 Run timing node。

预算分两层,口径不混:

- **Run 级共享准备**:BuildKey 构建、共享拉取或发布受独立构建并发、逐 key timeout、全局准备上限和 Invocation abort 约束,不占 attempt 并发位。
- **attempt 级实例物化**:创建资源组、服务 ready、Agent Ensure、执行与评分共享同一个 attempt 并发位和 deadline;attempt deadline 从拿到产物并开始创建 Sandbox 时起算。

共享构建不属于任一 attempt,不计入任何 attempt 的 `executionMs`;一次十分钟的冷构建在整份记录里只出现一次时间。
构建计时落 `RunMeta.timings` 的 `sandbox.build` activity,provenance 落 `sandboxBuilds`,两者经 `timingNodeId` 关联。
每个 BuildKey 是一个可并发 activity 实例,内部可挂 `provider.image.pull`、`provider.build.execute` 等开放子 key。
落盘形状单源在 [Record · 两层时间模型](../record/architecture.md#两层时间模型生命周期锚点与开放-activity)。

这个前置阶段不是无预算后台工作:Ctrl+C 停止新构建并调用 provider 的 build cancellation;无法取消的远端 build 进入可核对 registry,后续按 provider locator 认领或清理。
不依赖失败 BuildKey 的 attempt 继续执行,除非失败分类触发 eval / experiment scope 止损;carried attempt 不因查看历史结果触发构建,也不引用本 Run 不存在的 build。

## Docker Compose case

Docker provider 直接把任务 Compose 当原生运行时输入,不先编译成 NiceEval 的 services 词汇。
NiceEval 只生成必要的 overlay:

- 标记或补出 `mainService`;
- 注入 attempt 身份、受管目录与凭据引用;
- 应用资源上限和网络策略;
- 为清理、孤儿核对与留存写 project label。

启动前先按 BuildKey 执行 `docker compose build`,命中 BuildKit cache 时只做增量核对;随后 `docker compose up --detach --wait`。
Compose 自己处理 `depends_on`、healthcheck、网络 DNS、`extra_hosts`、volume 与逐服务构建。

未知 Compose 字段不因 NiceEval 解析器没见过就拒绝。
真正破坏核心不变量的字段由 Docker case 明确列黑名单——让 main 容器脱离受管网络、覆盖受管 workdir、挂载 Docker socket;错误必须点名字段与理由。
`dns`、`extra_hosts`、自定义 networks 与 sidecar 隔离可以直接构成题目语义,Docker case 不把它们归一化掉。
Agent 只能进入 main 容器;sidecar 文件系统只经题目网络交互或受控的判分采证接口可见——把 sidecar 合并进主 Sandbox 会改变题目,不属于合法降级。

主容器进入 ready 后才交给 Agent;判分完成前整组保持存活。
任一必需服务提前退出时 attempt `errored`,附服务状态与日志,不折叠成 Agent `failed`。
收尾按 case 自己的资源句柄执行 `compose down`;部分启动、中断与超时同样走整组 finalizer。
逐服务日志和 artifact 由 `ServiceController` 取得;artifact 声明只引用主 Sandbox 时所有 provider 都能运行,引用 sidecar 时启动期要求 `services` 能力并校验服务名存在。

## 云端 Compose case

云 provider 可以选择自己的完整实现,不要求复制 Docker provider 的进程结构:

- **DinD**:在云 Sandbox 内启动 daemon 与 Compose,主容器包装成返回的 Sandbox;外层 template 只预装 daemon、Compose 与共享基础 cache,不预烘每一道题。
- **Pod**:一个 Pod 里 main + sidecars,由 provider API 实现逐容器 exec、文件和日志。
- **原生组网**:多个实例接入 provider 私网,由 materializer 建立稳定服务名和资源组。

三种实现都必须满足相同的结果不变量:

1. Agent 与 `test(t)` 观察同一个主文件系统和网络视角。
2. 服务名在 Agent 与校验命令中解析一致。
3. 服务 ready 后才进入 Agent 生命周期。
4. 判分结束前服务存活;异常退出得到环境错误和证据。
5. 成功、失败、中断与超时都能按资源组回收。

实现若只能启动多实例、却不能让文件 API 指向 main 执行空间,就没有完成该 case,不能只开一个 `services` 布尔位。
把依赖 DNS、`extra_hosts` 或 sidecar 文件隔离的题改成单 template 不算支持——环境变化已经破坏题目判据。

## 自定义 case

自定义 provider 可以开放与内置 provider 同形的 environment 映射。
每个自定义 case 必须给出纯数据身份与 materializer:

```typescript
defineSandboxCase({
  identity: {
    kind: "kubernetes",
    cluster: "eval-prod",
    manifestDigest: "sha256:...",
  },
  capabilities: ["services"],
  materialize: async (ctx) => ({
    sandbox: mainPodSandbox,
    services: podServiceController,
    stop: stopNamespace,
  }),
});
```

约束:

- `identity` 必须可序列化;函数体不参与自动哈希,缺稳定身份时禁止结果携带,不能用函数名或 `toString()` 冒充环境指纹。
- 声明了某项能力就承担对应完整契约测试。
- 留存不是默认能力:只有同时提供可序列化定位信息、跨进程恢复与 detached stop,才可以声明 group keep;否则 `--keep-sandbox` 与该 case 的组合在创建前报错。

## 错误归属:五类互不冒充

| 失败点 | 结果 | 归属 |
|---|---|---|
| profile 键查不到 / case 声明非法 | 启动期配置错误 | 一次穷举报错,零 Sandbox 创建 |
| 声明合法但 provider 缺 materializer 或能力位 | 计划期 `skipped` | skipReason 写明缺项;全 `skipped` 升级启动期报错 |
| 共享构建失败 | 依赖它的 attempt `errored` | origin 指向 Run 的 `sandbox.build` timing node |
| 环境物化、ready、服务中途退出 | attempt `errored` | attempt 环境锚点,附服务状态与日志 |
| Agent Ensure 失败 | attempt `errored` | `agent.setup` 锚点(见 [Agent Ensure](../adapters/architecture/agent-ensure.md)) |

Agent 完成任务但断言未达标才是 `failed`。
每个 case 至少产出主环境启动日志与物化事实;声明 `services` 能力后还必须产出逐服务状态、失败日志与 ready timing。
证据字段是中性的,采集手段留在 provider。

## 清理、留存与注册表

运行期以主 Sandbox 为 Agent 锚点,但清理和留存针对 case 返回的**资源组**。
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
单 Sandbox case 的资源组只有 primary,现有行为是新模型的严格子集;单实例留存的注册表纪律与各 provider 的休眠语义见 [Architecture · 留存与注册表](architecture.md#留存keep与注册表)。

Group keep 是独立能力:支持者必须能整组 suspend / resume、恢复后重过 ready 门、失败时保留可再次清理的注册项。
只暂停主 Sandbox、让 sidecar 继续运行或丢失的实现不得声明。

## 泄题门:verifier 与 build context 的交叉检查

folder eval 的 verifier / private 文件与环境输入共址,泄漏面必须在发现期收口:

- 发现期把已登记 verifier / private 路径与每个 Docker build context 的 `.dockerignore` 求值结果做交叉检查;仍会进入 build context 的隐藏文件按配置错误报出,因为一行 `COPY . .` 就足以把它泄给 Agent。
- 修法三选一:移出 context、写进 `.dockerignore`、或让 materializer 生成等价的 filtered context;过滤规则自身进入 BuildKey。
- 检查覆盖 Compose 的全部 build context,不只 mainService;相对 bind mount 按服务可见面检查——verifier 可以在判分阶段挂进 main,但不能在 Agent 阶段挂入任一 Agent 可达服务,private 文件任何阶段都不能挂入。
- 只有显式改成普通 fixture 才允许 Agent 可见,没有任何绕过开关。

verifier / private 的登记方式与三类文件的身份归属见 [Eval · 目录入口](../eval/README.md)。

## Provider 能力矩阵

每个 provider 声明自己支持的 case 集合;「不同 provider 有不同 case 集合」是诚实的能力边界,不是 core 不通用:

| provider | 预制单 Sandbox | 按需构建单 Sandbox | Compose |
|---|---|---|---|
| Docker | image | Dockerfile / context | 原生 Compose case |
| E2B | template | 单 Dockerfile 构建成内容寻址 template | 不声明;兑现 DinD 或原生组网全部义务并通过真机契约测试后才开放 |
| Vercel Sandbox | snapshot | 不声明 | 不声明 |
| Local | 宿主机即环境,无产物参数 | 不声明 | 不声明 |

云 provider 不因为「是完整 Linux VM」就自动进入云端 Compose case;未通过契约测试就不声明,对应 eval 计划期 `skipped`。
没有声明 Compose 能力的 provider 仍完整支持单 Sandbox case;外部编排继续作为 provider 无对应 case 时的用户侧退路(见 [Library · 环境预置放哪](library.md#环境预置放哪))。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— provider 选择、生命周期 Hook、自定义 provider。
- [Architecture](architecture.md) —— 生命周期时序、留存注册表、孤儿核对、重试。
- [Record · 两层时间模型](../record/architecture.md#两层时间模型生命周期锚点与开放-activity) —— `sandbox.build` activity 与 `sandboxBuilds` 的落盘形状。
- [Adapters · Agent Ensure](../adapters/architecture/agent-ensure.md) —— case 产出主 Sandbox 之后,Agent 怎样检查与安装。
- [Experiments · 缓存与携带](../experiments/cache.md) —— CaseKey 怎样进入指纹与携带门。
