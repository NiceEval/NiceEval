# PLAN-4 —— 能力分型:公共 Sandbox + provider sandbox case(推荐)

**相关文档**:[README](../README.md) · [真题落地样例](use-case/README.md) · [GOALS](../GOALS.md) ·
[LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) ·
[PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

---

## 实现方案 4(能力分型,推荐)

### 简述

保留一份足够通用的主 `Sandbox` 契约,不要求所有 provider
共享同一种环境拓扑或构建与启动方法。Eval 仍只声明不透明
environment profile;每个 Sandbox provider 的 `environments`
表把 profile 翻译成该 provider 支持的完整 sandbox case。
Docker 可以直接消费 Compose,E2B 可以消费 template,支持
Compose 的云 provider 可以选择 DinD、Pod 或原生多实例组网。

每一种公开 case 都必须给齐启动、就绪、Agent 可见面、判分、
证据、指纹、清理与留存故事。「provider-specific」不是少做
契约,而是不把不同运行载体伪装成同一种实现。

```text
eval.environment(profile)
 → 当前 SandboxSpec 的 environments[profile]
 → provider-specific SandboxCase.materialize()
 → 主 Sandbox + 可选能力句柄
 → 现有 Agent / Eval / scoring 生命周期
 → case 自己采证、留存或整组销毁
```

### 公共不变量

所有 sandbox case 都必须返回唯一一个**主 Sandbox**。
Agent、`test(t)` 的命令、文件上传、workdir、变更分类账与
diff 必须观察同一个执行空间。公共 `Sandbox` 继续只定义
这些跨 provider 稳定的行为:

```typescript
interface Sandbox {
  readonly workdir: string;
  runCommand(...): Promise<CommandResult>;
  runShell(...): Promise<CommandResult>;
  readFile(...): Promise<Buffer>;
  writeFiles(...): Promise<void>;
  uploadDirectory(...): Promise<void>;
  stop(): Promise<void>;
}
```

单容器时,主 Sandbox 就是该容器或 microVM。Compose case
中,主 Sandbox 是 `mainService` 对应的容器。云 provider
若在 VM / Pod 内启动 Compose,返回的 Sandbox 必须把所有
命令和文件操作代理进 main 容器;外层 VM 只是构建并启动宿主,
不能继续冒充 Agent 的执行空间。

额外能力不作为所有 Sandbox 的必选接口字段,由 case 在创建
时附带能力句柄。第一期只需要服务能力:

```typescript
interface ServiceController {
  exec(service: string, command: string[]): Promise<CommandResult>;
  collectLogs(service: string): Promise<Artifact>;
  stop(service: string): Promise<void>;
}
```

Runner、评分与报告不按 provider 名分支。需要逐服务采证或
控制时检查 `services` 能力;普通单 Sandbox eval 完全不接触
这层。以后 GPU、动态网络策略或整组 checkpoint 也按独立
能力扩展,不把它们揉成一个「高级 Sandbox」布尔值。

### 配置形态

Environment profile 的名字保持 provider 中性,值回到选择
provider 的 SandboxSpec,不再由 `config.environments` 通用
拓扑与 spec 产物表两处拼接。

环境来源有两种同等的一等写法:

1. **共享 profile。** 多条 eval 共用一个已经命名的预制环境
   或外部环境目录时,继续写字符串 id,由 SandboxSpec 的
   `environments` 表解析。
2. **folder-local eval。** 一道 eval 自己拥有 Dockerfile、
   Compose 与 fixture 时,可以在目录入口 `eval.ts` 里直接声明
   sandbox source。Eval 目录路径同时生成 eval id 与
   默认 profile id;不要求再去中央 `cases.ts` 手抄一遍。

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
const environment = composeSandbox({
  file: new URL("./docker-compose.yaml", import.meta.url),
  mainService: "client",
  build: "on-demand",
  executionUser: "image",
});

export default defineEval({
  environment,
  async test(t) { /* send 后上传同目录 verifier 再判分 */ },
});
```

上例是候选 DX。`composeSandbox` 只声明 Compose source
及主执行空间,不承诺所有 provider 都能消费。

两种写法在 SandboxSpec 上各有一个入口:`environments` 表按
profile 名映射完整 case;`materializers` 表按 source kind
(如 `compose`、`dockerfile`)注册 folder-local 声明的
materializer。同一 profile 两处都命中时,显式 `environments` 表项
优先——这就是 provider 用预建产物覆盖按需构建的口子。
内部最终都归一成「稳定 profile + provider-specific
SandboxCase」,Runner 不按 inline / central 两种写法
分支。

Docker SandboxSpec 可以注册原生 Compose materializer。E2B
只有明确配置并实现 DinD/Pod materializer 后才支持 Compose
source;没有对应 materializer 时按能力缺失处理(见下)。

内置 case 的表值是 provider 原生纯数据,靠判别键区分,
类型由 spec 工厂的参数类型给出——表值已经在该 provider 的
括号里,不再为每种 case 导出一个带 provider 前缀的构造
函数。判别键组合非法(如同时给 `template` 与 `build`)在
spec 构造期报错,一次穷举。Docker 对一个 TB 任务直接声明
Compose case:

```typescript
dockerSandbox({
  environments: {
    "tb-sheets": {
      compose: {
        file: "tasks/simple-sheets-put/docker-compose.yaml",
        mainService: "client",
        env: { T_BENCH_TEST_DIR: "/tests" },
      },
    },
  },
});
```

同一个 profile 在 E2B 下可以映射成已经构建好的单环境
template:

```typescript
e2bSandbox({
  environments: {
    "tb-sheets": { template: "acme/tb-sheets-v5" },
  },
});
```

这两项不要求结构同构。它们只需兑现同一条 eval 所依赖的
外部行为:任务依赖在场、主 Sandbox 可操作、测试所需服务
可达、判分时环境仍活着。项目负责选择它认可为可比较的两份
实现;niceeval 负责把各自精确身份纳入指纹并记录实际构建并启动
事实。

两类缺失分开判。eval 引用的 profile 键任何表都查不到、
自己也没有 folder-local source,是键名笔误的形状:启动期
配置错误,一次穷举,零 Sandbox 创建。声明合法、但当前
provider 既无该 profile 的 `environments` 表项、也无该
source kind 的 materializer,是能力缺失:该组合零成本
计划期 `skipped`。skipReason 同时列 eval id、source kind
与可补的映射位置;选中集合全部 `skipped` 时升级为启动期
报错,不产出绿色空跑。

两条路都不自动把 Docker Compose 翻译成近似环境,也不回退到
默认单 Sandbox。这比运行十分钟后得到假 `failed` 更安全。

### Eval 文件夹是一等 authoring unit

发现器同时接受现有单文件与文件夹入口:

```text
evals/foo.eval.ts        → eval id "foo"
evals/foo/eval.ts        → eval id "foo"
```

同一个 id 两种入口同时存在时启动期报重名,不按扫描顺序覆盖。
`eval.ts` 只是文件夹入口约定,仍默认导出 `defineEval` 结果;
不引入第二套评分或 Experiment 模型。目录中可以平铺
Dockerfile、Compose、task data、初始 fixture 与 verifier,
也可以按需要分子目录。

共址不等于同一身份域或同一可见时点:

- sandbox source 闭包进 BuildKey / CaseKey;
- `loadYaml` / `loadText` 读的题面数据进 eval 数据指纹;
- `loadCriteria` 登记的 verifier 进 eval 判据指纹,最后一次
  `send` 后才上传;
- eval `setup` 上传的 fixture 在 Agent 前可见,属于 eval
  归因;
- solution / reference 默认不进入可运行 eval folder;必须
  共址时声明 private,永不上传也不得进入最终镜像。

发现期把已登记 verifier/private 路径与每个 Docker build
context 的 `.dockerignore` 求值结果做交叉检查。仍会被发送
进 build context 的隐藏文件默认是配置错误,因为
`COPY . .` 足以把它泄给 Agent。用户可以把它移出 context,
写进 `.dockerignore`,或让 materializer 生成
等价的 filtered context;过滤规则自身进入 BuildKey。只有
显式改成普通 fixture 才允许 Agent 可见,不能用一个
`allowVerifierLeak` 开关绕过。

这条保护也适用于 Compose 中多个 build context,不能只检查
mainService。相对 bind mount 则按服务可见面检查:verifier
可以在判分阶段挂进 main,但不能在 Agent 阶段预先挂入任一
Agent 可达服务;private 文件任何阶段都不能挂入。

### Profile、基座与最终环境身份

`tb-ubuntu-24-04`、`tb-python-3-13` 这类名字只描述可共享
的基座家族,不能作为题目最终环境身份。逐题 Dockerfile 的
`RUN` 会写入题面数据、坏配置、权限位与专用工具链;即使
`FROM` 相同,这些输入不同就必须得到不同 case
identity。

Terminal-Bench 一类导入器为每道任务生成独立 profile 映射,
例如 `terminal-bench/debug-long-program`,不要求用户手写
数百条 alias。映射值可以引用同一个基座,但同时携带该题的
环境定义目录:

```typescript
e2bSandbox({
  environments: terminalBenchSandboxCases("tasks", {
    build: "on-demand",
    bases: {
      "ubuntu-24.04": "acme/tb-ubuntu-24-04",
      "python-3.13": "acme/tb-python-3-13",
    },
  }),
});
```

上例是候选 DX,不是已经裁决的公开函数。导入器的产品义务
是把每道任务展开成纯数据 case:逻辑 profile、Dockerfile /
Compose 路径、精确 build context 清单、基座提示与内容哈希。
基座只参与 layer/template cache;最终身份认全部逐题输入。

### 按需构建 case

Sandbox case 可以引用预制产物,也可以声明按需构建。
按需构建是 provider materializer 的完整 case,不是
`sandbox.setup` 里的一段无身份 shell:

```typescript
e2bSandbox({
  environments: {
    "tb-debug": {
      build: {
        context: "tasks/debug-long-program/environment",
        dockerfile: "Dockerfile",
      },
    },
  },
});
```

规划期在任何携带决策之前计算每个待构建产物自己的
`BuildKey`:

```text
BuildKey
 = builder kind + builder revision + target platform
 + Dockerfile bytes
 + .dockerignore 求值后的 build context 内容
 + build args 的非敏感解析值
 + FROM 解析后的 digest
```

一个 Compose case 可以有零个、一个或多个 BuildKey。
`simple-sheets-put` 的 `client` 与 `api` 就是两个独立构建;
仅引用 `postgres:15` 的 `db` 没有 BuildKey,只记录解析后的
image digest。构建结果另有 provider 原生 locator,例如
Docker image digest 或 E2B template id。BuildKey 是「为什么
应该得到同一构建产物」,locator 是「本次从哪里启动」;两者
都进运行记录。

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

因此 `debug-long-program/debug_server.py` 虽然只是挂进 sidecar、
不触发 client 镜像重建,改动后仍会得到新的 CaseKey 并重跑。
逐 attempt 的容器名、临时目录和随机 project name 不进入
CaseKey;它们作为实际 image digest、容器名等运行事实记录。凭据值仍按后文规则排除。
BuildKey 负责image 或 template复用,CaseKey 才是 attempt 环境身份与携带
门。这样 Dockerfile、Compose 或挂载源码改动都会自动失效,
不需要维护者改 alias 通知 niceeval。

构建协调按本次仍需执行的 attempt 所引用的 BuildKey 分组:

1. 先做携带规划;全部命中的环境不为查看旧结果而构建。
2. 查询 provider 原生 cache 或本地 build registry。
3. 同 key 只允许一个 builder,single-flight 等待者不重复
   上传 context 或创建 template。
4. cache miss 才调用 provider 原生构建 API;成功后以
   BuildKey 登记 locator,再放行依赖它的 attempt。
5. 确定性构建失败按共享该 key 的范围止损,所有依赖 attempt
   得到同一环境错误,不让每个 attempt 各烧一次。

构建协调有独立的有界并发与 `buildTimeoutMs`,不占 Agent
attempt 并发位。等待构建的 attempt 尚未进入执行阶段,
attempt deadline 从拿到产物并开始创建 Sandbox 时起算。
构建耗时只在 Run 级 `sandboxBuilds` 记录一次,每个相关
attempt 引用该条 provenance。这样冷 cache 的十分钟构建不会
被复制成十个 attempt 的 `executionMs`,但整次 Run 仍完整
展示这笔时间与失败。

这个前置阶段不是无预算后台工作:它受 Invocation abort、
构建并发、逐 key timeout 与全局环境准备上限约束。Ctrl+C
停止新构建并调用 provider 的 build cancellation;无法取消的
远端 build 进入可核对 registry,后续按 provider locator
认领或清理。

### 完整 case 目录

第一期明确支持五类,每类都有独立验收,不是只留扩展点:

| Case | 声明来源 | 主 Sandbox | 伴随资源 | 第一责任方 |
|---|---|---|---|---|
| 预制单 Sandbox | provider 起点产物 | 该实例 | 无 | 对应 provider |
| 按需构建单 Sandbox | Dockerfile / OCI context | 构建产物实例 | 无 | 声明支持构建的 provider |
| Docker Compose | Compose + overlay | `mainService` 容器 | 同项目 services / network | Docker provider |
| 云端 Compose | Compose + provider 配置 | main 容器 | DinD、Pod 或原生组网 | 声明支持的云 provider |
| 自定义 case | 用户纯数据身份 + materializer | 用户返回的 Sandbox | 用户句柄 | 自定义 provider |

E2B、Vercel 等 provider 不因为「是完整 Linux VM」就自动
进入云端 Compose case。只有实现了主容器代理、同网服务、
整组回收与证据义务,并通过契约测试后才声明支持。没有声明
Compose 能力的 provider 仍完整支持单 Sandbox case,用户
可以给 profile 构建一个单 template;框架不强迫 VM 内
Docker。

### Docker Compose case

Docker provider 直接把任务 Compose 当原生运行时输入,不先
编译成 niceeval 的 `services` DSL。Niceeval 只生成必要的
overlay:

- 标记或补出 `mainService`;
- 注入 attempt 身份、受管目录与凭据引用;
- 应用资源上限和网络策略;
- 为清理、孤儿核对与留存写 project label。

启动前先按 BuildKey 执行 `docker compose build`,命中
BuildKit cache 时只做增量核对;随后使用
`docker compose up --detach --wait`。Compose 自己处理
`depends_on`、healthcheck、网络 DNS、`extra_hosts`、volume
与逐服务构建。
未知 Compose 字段不因 niceeval 解析器没见过就拒绝;真正
不安全或破坏核心不变量的字段由 Docker case 明确列黑名单,
例如让 main 容器脱离受管网络、覆盖受管 workdir 或挂载
Docker socket。错误必须点名字段与理由。

`dns`、`extra_hosts`、自定义 networks 与 sidecar 隔离可以
直接构成题目语义,因此 Docker case 不把它们归一化掉。Agent
只能进入 main 容器;sidecar 文件系统只经题目网络交互或受控
的判分采证接口可见。把 sidecar 合并进主 Sandbox 会改变
题目,不属于合法降级。

主容器进入 ready 后才交给 Agent。判分完成前整组保持存活;
任一必需服务提前退出时 attempt `errored`,附服务状态与
日志,不折叠成 Agent `failed`。收尾按 case 自己的资源句柄
执行 `compose down`;部分启动、中断与超时同样走整组
finalizer。

逐服务日志和 artifact 由 `ServiceController` 取得。Artifact
声明若只引用主 Sandbox,所有 provider 都能运行;引用 sidecar
时,启动期要求 services 能力并校验服务名存在。

### 云端 Compose case

云 provider 可以选择自己的完整实现,不要求复制 Docker
provider 的进程结构:

- **DinD:**在云 Sandbox 内启动 daemon 与 Compose,主容器
  包装成返回的 Sandbox。
- **Pod:**一个 Pod 里 main + sidecars,由 provider API
  实现逐容器 exec、文件和日志。
- **原生组网:**多个实例接入 provider 私网,由 materializer
  建立稳定服务名和资源组。

DinD 路径把任务 context 上传到外层 Sandbox,按 BuildKey 在
其中执行 Compose build/up。外层 template 只预装 daemon、
Compose 与共享基础 cache,不预烘每一道题。Provider 若支持
持久 volume、snapshot 或 registry cache,用 BuildKey 复用
逐题构建结果;只能冷构建也可以声明支持,但必须在运行计划中
展示预计成本,不能假装是预制 template 命中。

E2B 的单 Dockerfile case 可以直接把任务 context 构建成
内容寻址 template;多容器题只有在 E2B Compose case 兑现
DinD 或原生组网的全部义务后才开放。把依赖 DNS、
`extra_hosts` 或 sidecar 文件隔离的题改成单 template 不算
支持,因为环境变化已经破坏题目判据。

三种实现都必须满足相同的结果不变量:

1. Agent 与 `test(t)` 观察同一个主文件系统和网络视角。
2. 服务名在 Agent 与校验命令中解析一致。
3. 服务 ready 后才进入 Agent 生命周期。
4. 判分结束前服务存活;异常退出得到环境错误和证据。
5. 成功、失败、中断与超时都能按资源组回收。

实现若只能启动多实例、却不能让文件 API 指向 main 执行
空间,就没有完成该 case,不能只开一个 `services` 布尔位。

### 自定义 case

自定义 provider 可以开放与内置 provider 同形的 environment
映射。每个自定义 case 必须给出纯数据身份与 materializer:

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

这是候选内部形状,公开前仍需 API 调用点评审。约束先定:
函数体不参与自动哈希,`identity` 必须可序列化;声明了某项
能力就承担对应完整契约测试。缺稳定身份时禁止结果携带,
不能用函数名或 `toString()` 冒充环境指纹。

自定义 case 的留存不是默认能力。只有同时提供可序列化定位
信息、跨进程恢复与 detached stop,才可以声明 group keep;
否则 `--keep-sandbox` 与该 case 的组合在创建前报错。

### 身份与指纹

不同 case 用自己的原生事实定义身份,核心只要求得到规范化
纯数据:

- **预制单 Sandbox:**锁定 image digest、template id /
  revision 或 snapshot id。
- **按需构建单 Sandbox:**使用 BuildKey;构建产物
  locator 与实际 digest 作为运行事实。
- **Docker Compose:**使用 CaseKey;其中引用各
  BuildKey、Compose 与 niceeval overlay、插值变量名、相对
  bind mount、env/config/secret 文件及可解析 image digest。
  第一期允许注释变化触发保守重跑,不为消掉 false rerun
  实现 Compose 语义解释器。
- **云端 Compose:**任务输入身份 + provider 构建与启动策略版本 +
  实际镜像/模板身份。
- **自定义 case:**用户声明的 `identity`,并把实际资源事实
  作为运行记录供事后核对。

身份解析发生在携带决策之前。浮动 image tag 若 provider
不能解析成 digest,该环境的旧结果不参与携带;
可以运行并记录 tag 与实际事实,但不能假装两次环境可比。

凭据值不落盘。凭据轮换若不改变环境语义,只记录引用名;
凭据同时选择了不同租户、数据集或权限面时,用户必须提供
非敏感 `revision` 进入 identity,不能靠 secret 值自动推断。

### 调度、错误与证据

共享构建由前述有界协调层负责。产物就绪后,
Sandbox case 的实例启动阶段进入 attempt 并发位与
deadline:主 Sandbox 创建、伴随服务 ready、Agent Ensure、
执行与评分共享同一个 attempt 预算。Provider 可以增加镜像
拉取或网络配额,但不能在两个调度层之外偷跑无界工作。

错误按阶段归属:

- profile 键任何表都查不到、case 配置非法:启动期配置
  错误;
- 映射与声明合法、当前 provider 缺 materializer 或能力位:
  计划期 `skipped`,写明缺项,不进通过率分母;选中集合
  全部 `skipped` 升级为启动期报错;
- 构建所需 image、创建网络、启动 Sandbox 与服务并等待 ready、ready、服务中途退出:attempt `errored`;
- Agent Ensure 失败:`agent.setup` 的 `errored`;
- Agent 完成但断言未达标:`failed`。

每个 case 至少产出主环境启动日志与实际 image digest、容器名等运行事实。声明 services
能力后,还必须产出逐服务状态、失败日志与 ready timing。
证据字段是中性的,采集手段留在 provider。

### 清理、留存与注册表

运行期仍以主 Sandbox 为 Agent 锚点,但清理和留存针对
sandbox case 返回的**资源组**。注册表不硬编码
`services[]`、`network` 或 Kubernetes namespace 字段,只存:

```typescript
interface SandboxGroupEntry {
  provider: string;
  profile: string;
  primary: SandboxLocator;
  resources: ProviderLocator;
  state: "alive" | "dormant" | "partial";
}
```

`resources` 是 provider 自己可序列化、可 detached stop 的
定位数据。`sandbox enter` 仍进入 `primary`;`sandbox stop`
把整组交回对应 provider 销毁。单 Sandbox case 的资源组
只有 primary,现有行为是严格子集。

Group keep 是独立能力。支持者必须能整组 suspend / resume、
恢复后重过 ready 门、失败时保留可再次清理的注册项。只会
暂停主 Sandbox、让 sidecar 继续运行或丢失的实现不得声明。

### 优势

- **足够通用。** Eval、Agent、评分只依赖主 Sandbox;多服务
  与未来能力有稳定扩展位置。
- **每型完整。** Docker Compose、云端 Compose、单 Sandbox
  与自定义 case 分别承担生命周期、指纹、证据和清理,不是
  一张能力表后面留空。
- **不伪造可移植性。** 同一 profile 可以在不同 provider
  映射到不同原生实现,项目明确选择哪些环境可比较。
- **复用成熟工具。** Docker case 直接使用 Compose 语义,
  不长期维护一个不断追上游的解析子集。
- **核心中立。** Runner 依赖 Sandbox 与能力句柄,不按
  Docker、E2B 或 Kubernetes 名字分支。

### 缺点

- 同一个 profile 的 provider 映射需要项目分别维护,不会由
  niceeval 自动把一个 Compose 文件变成所有云环境。
- 跨 provider 可比性不能只看 profile 名;项目必须确认不同
  case 兑现相同任务语义,记录页也要展示实际 case
  identity。
- Provider case 数量会增长。每种 case 都有完整义务测试,
  接入成本高于只实现 `Sandbox` 最小接口。
- 直接消费 Compose 会接受更大的上游语义面;Niceeval 只对
  自己注入的 overlay 与安全不变量负责,不能承诺解释任意
  Compose 行为。

---

### 落地路线

1. 定主 Sandbox 不变量、可选 `ServiceController` 与内部
   SandboxCase 生命周期;先不改公开 Eval 形状。
2. 把 profile 映射收回各 SandboxSpec,删除 config/spec 两表
   拼接候选;补缺映射的一次穷举报错。
3. 实现 BuildKey、目录闭包哈希、构建 registry、
   有界并发与跨 attempt single-flight。
4. 实现 folder-local `eval.ts` 发现、inline source
   归一化及 verifier/private 与 build context 的泄漏门。
5. 实现 Docker Compose case:原生 build/up + 受管 overlay、
   main Sandbox 包装、ready、日志、整组回收。
6. 把单 image/template/snapshot 现有路径包装成单 Sandbox
   case,证明旧行为是新模型的严格子集。
7. 实现一个 E2B 单 Dockerfile 按需构建 case,证明同一
   BuildKey 命中同一 template cache、改 context 自动重建。
8. 指纹按 case 分型;记录实际 environment identity 与构建并启动
   事实,保守关闭无法证明身份的携带。
9. 注册表改成 provider locator 资源组,再实现 Docker group
   keep;不在第一期承诺所有 provider keep 多服务。
10. 选择一个真实云 provider 完成 Compose case 契约测试;
   其余 provider 保持单 Sandbox,不因 VM 理论可行提前开位。
11. 开放自定义 sandbox case,完成序列化身份与 detached
   cleanup 的 API 评审。

---

### 验收 / Definition of Done

1. **单 Sandbox 完整。** Docker image、E2B template 与
   Vercel snapshot 的现有 eval 零行为变化。
2. **按需构建。** 两条 attempt 引用同一逐题 Dockerfile,
   冷 cache 只构建一次;第二次 Run 命中 locator;改任一
   context 文件自动生成新 BuildKey 并重建。
3. **Docker Compose 完整。** 一个真实 TB Compose 直接运行,
   main 中的 Agent 与 sidecars 同网;ready、评分、日志与整组
   down 全链路可验证。
4. **题目隔离保持。** sidecar 隔离题中 Agent 无法读取
   sidecar 源码与文件系统,只能按题面经网络交互;DNS 与
   `extra_hosts` 题保留 Compose 的真实解析行为。
5. **主空间一致。** 云端 Compose case 的 `runCommand`、
   upload、Agent cwd、分类账与 diff 全部落在 main 容器,
   外层 VM / Pod 不泄漏成第二套坐标。
6. **不支持不假绿。** E2B 未提供 `"tb-sheets"` 映射也未
   注册 compose materializer 时,该题计划期 `skipped` 并
   点名缺项;选中集合全部 `skipped` 时启动期报错;两条路
   都不把 Docker Compose 静默换成基础 template。
7. **指纹分型。** 改 Compose、build context、template id
   或 materializer revision 都触发重跑;无法解析浮动身份时
   不携带旧结果。
8. **服务失败归因。** sidecar ready 失败或评分前退出得到
   `errored`,artifact 含对应服务日志,不进入 Agent 失败分母。
9. **整组回收。** 部分启动、Ctrl+C、超时与正常结束都不留
   无主资源;支持 group keep 的 case 恢复后重过 ready。
10. **自定义闭环。** 一个 Kubernetes 自定义 case 提供主
   Sandbox、services、身份与 detached cleanup,通过同一套
   能力契约测试。
11. **构建与整组身份不混。** `simple-sheets-put` 分别缓存
    client/api 两个 BuildKey;只改
    `debug-long-program/debug_server.py` 不重建 client 镜像,
    但改变 CaseKey、禁止携带旧结果。
12. **文件夹安全。** `evals/x/eval.ts` 的 id 是 `x`;
    同目录 verifier 改动只作废 eval 判据。Verifier 或 private
    文件未从任一 Docker context 排除时发现期失败,不会启动
    一个可能已经泄题的 Sandbox。

**反指标**:

- 因为 provider 是 VM 就宣布支持 services,实际文件 API 和
  Agent 位于两个执行空间。
- 核心出现 `provider === "docker"` 分支,而不是消费 case
  返回的 Sandbox 与能力句柄。
- 为了声称 provider-neutral,把 Compose 的 `privileged`、
  volume、network 等字段静默丢掉后继续运行。
- 只实现 `start services`,没有 ready、日志、指纹或强杀
  清理,却把它登记成完整多环境支持。
- 仍要求维护者先批量发布每道题的 template alias;Dockerfile
  改动不会自动改变环境身份。

---

### 和其它方案的关系

- **vs PLAN-1**:保留规范化身份、生命周期和证据义务,否决
  「规范化 OCI 拓扑是唯一契约实体」。本案的通用点是主
  Sandbox 与能力结果,不是所有 provider 共用的构建输入。
- **vs PLAN-2**:Docker case 同样直接消费 Compose,但不把
  Compose agent service 翻译成跨 provider 起点。每个
  provider 自己给 profile 一份完整映射。
- **vs PLAN-3**:服务仍由 niceeval 选中的 sandbox case
  管理,因此 ready、指纹、证据和回收不外包;只是构建与启动实现
  回到 provider。
- **与 Agent 安装 PLAN-4**:case 先产出主 Sandbox,Agent
  provisioner 再执行检查→必要时安装。官方 Agent template
  是检查命中优化,任务 template 后装 Agent 是同等支持路径。
