# PLAN-4 —— 能力分型:公共 Sandbox + provider environment case

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) ·
[PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 实现方案 4(复审候选)

### 简述

保留一份足够通用的主 `Sandbox` 契约,不要求所有 provider
共享同一种环境拓扑或物化方法。Eval 仍只声明不透明
environment profile;每个 Sandbox provider 的 `environments`
表把 profile 翻译成该 provider 支持的完整 environment case。
Docker 可以直接消费 Compose,E2B 可以消费 template,支持
Compose 的云 provider 可以选择 DinD、Pod 或原生多实例组网。

每一种公开 case 都必须给齐启动、就绪、Agent 可见面、判分、
证据、指纹、清理与留存故事。「provider-specific」不是少做
契约,而是不把不同底座伪装成同一种实现。

```text
eval.environment(profile)
 → 当前 SandboxSpec 的 environments[profile]
 → provider-specific EnvironmentCase.materialize()
 → 主 Sandbox + 可选能力句柄
 → 现有 Agent / Eval / scoring 生命周期
 → case 自己采证、留存或整组销毁
```

### 公共不变量

所有 environment case 都必须返回唯一一个**主 Sandbox**。
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
  uploadFiles(...): Promise<void>;
  stop(): Promise<void>;
}
```

单容器时,主 Sandbox 就是该容器或 microVM。Compose case
中,主 Sandbox 是 `mainService` 对应的容器。云 provider
若在 VM / Pod 内启动 Compose,返回的 Sandbox 必须把所有
命令和文件操作代理进 main 容器;外层 VM 只是物化宿主,
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

Docker 对一个 TB 任务直接声明 Compose case:

```typescript
dockerSandbox({
  environments: {
    "tb-sheets": dockerComposeEnvironment({
      file: "tasks/simple-sheets-put/docker-compose.yaml",
      mainService: "client",
      env: { T_BENCH_TEST_DIR: "/tests" },
    }),
  },
});
```

同一个 profile 在 E2B 下可以映射成已经构建好的单环境
template:

```typescript
e2bSandbox({
  environments: {
    "tb-sheets": e2bEnvironment({
      template: "acme/tb-sheets-v5",
    }),
  },
});
```

这两项不要求结构同构。它们只需兑现同一条 eval 所依赖的
外部行为:任务依赖在场、主 Sandbox 可操作、测试所需服务
可达、判分时环境仍活着。项目负责选择它认可为可比较的两份
实现;niceeval 负责把各自精确身份纳入指纹并记录实际物化
事实。

缺少 `environments[profile]` 仍是启动期配置错误,一次穷举,
零 Sandbox 创建。一个 provider 没有对应 case 时不自动把
Docker Compose 翻译成近似环境,也不回退到默认单 Sandbox。
这比运行十分钟后得到假 `failed` 更安全。

### 完整 case 目录

第一期明确支持四类,每类都有独立验收,不是只留扩展点:

| Case | 声明来源 | 主 Sandbox | 伴随资源 | 第一责任方 |
|---|---|---|---|---|
| 单 Sandbox | provider 起点产物 | 该实例 | 无 | 对应 provider |
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

启动使用 `docker compose up --detach --wait`;Compose 自己
处理 `depends_on`、healthcheck、网络 DNS、volume 与构建。
未知 Compose 字段不因 niceeval 解析器没见过就拒绝;真正
不安全或破坏核心不变量的字段由 Docker case 明确列黑名单,
例如让 main 容器脱离受管网络、覆盖受管 workdir 或挂载
Docker socket。错误必须点名字段与理由。

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
defineEnvironmentCase({
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

- **单 Sandbox:**锁定 image digest、template id / revision
  或 snapshot id。
- **Docker Compose:**Compose 文件与 niceeval overlay 内容、
  插值变量名、引用的 Dockerfile 与 build context 内容哈希、
  可解析 image digest。第一期允许注释变化触发保守重跑,
  不为消掉 false rerun 实现 Compose 语义解释器。
- **云端 Compose:**任务输入身份 + provider 物化策略版本 +
  实际镜像/模板身份。
- **自定义 case:**用户声明的 `identity`,并把实际资源事实
  作为运行记录供事后核对。

身份解析发生在携带决策之前。浮动 image tag 若 provider
不能解析成 digest,该 environment 的旧结果不参与携带;
可以运行并记录 tag 与实际事实,但不能假装两次环境可比。

凭据值不落盘。凭据轮换若不改变环境语义,只记录引用名;
凭据同时选择了不同租户、数据集或权限面时,用户必须提供
非敏感 `revision` 进入 identity,不能靠 secret 值自动推断。

### 调度、错误与证据

Environment case 的整个 materialize 阶段在 attempt 并发位
与 deadline 内。主 Sandbox 创建、伴随服务 ready、Agent
Ensure、执行与评分共享同一个 attempt 预算;provider 可以
在内部增加镜像构建或网络配额,但不能在全局并发位外偷跑
无界工作。

错误按阶段归属:

- profile 缺映射、case 配置非法:启动期配置错误;
- 环境物化、ready、服务中途退出:attempt `errored`;
- Agent Ensure 失败:`agent.setup` 的 `errored`;
- Agent 完成但断言未达标:`failed`;
- 用户显式运行 provider 矩阵且某个组合没有声明所需能力时,
  才可以产生 `skipped`;单 provider run 全部不支持仍升级为
  启动期错误,不产出假绿。

每个 case 至少产出主环境启动日志与物化事实。声明 services
能力后,还必须产出逐服务状态、失败日志与 ready timing。
证据字段是中性的,采集手段留在 provider。

### 清理、留存与注册表

运行期仍以主 Sandbox 为 Agent 锚点,但清理和留存针对
environment case 返回的**资源组**。注册表不硬编码
`services[]`、`network` 或 Kubernetes namespace 字段,只存:

```typescript
interface EnvironmentRegistryEntry {
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
  case 兑现相同任务语义,记录页也要展示实际 environment
  identity。
- Provider case 数量会增长。每种 case 都有完整义务测试,
  接入成本高于只实现 `Sandbox` 最小接口。
- 直接消费 Compose 会接受更大的上游语义面;Niceeval 只对
  自己注入的 overlay 与安全不变量负责,不能承诺解释任意
  Compose 行为。

---

### 落地路线

1. 定主 Sandbox 不变量、可选 `ServiceController` 与内部
   EnvironmentCase 生命周期;先不改公开 Eval 形状。
2. 把 profile 映射收回各 SandboxSpec,删除 config/spec 两表
   拼接候选;补缺映射的一次穷举报错。
3. 实现 Docker Compose case:直接 Compose + 受管 overlay、
   main Sandbox 包装、ready、日志、整组回收。
4. 把单 image/template/snapshot 现有路径包装成单 Sandbox
   case,证明旧行为是新模型的严格子集。
5. 指纹按 case 分型;记录实际 environment identity 与物化
   事实,保守关闭无法证明身份的携带。
6. 注册表改成 provider locator 资源组,再实现 Docker group
   keep;不在第一期承诺所有 provider keep 多服务。
7. 选择一个真实云 provider 完成 Compose case 契约测试;
   其余 provider 保持单 Sandbox,不因 VM 理论可行提前开位。
8. 开放自定义 environment case,完成序列化身份与 detached
   cleanup 的 API 评审。

---

### 验收 / Definition of Done

1. **单 Sandbox 完整。** Docker image、E2B template 与
   Vercel snapshot 的现有 eval 零行为变化。
2. **Docker Compose 完整。** 一个真实 TB Compose 直接运行,
   main 中的 Agent 与 sidecars 同网;ready、评分、日志与整组
   down 全链路可验证。
3. **主空间一致。** 云端 Compose case 的 `runCommand`、
   upload、Agent cwd、分类账与 diff 全部落在 main 容器,
   外层 VM / Pod 不泄漏成第二套坐标。
4. **不支持大声失败。** E2B 未提供 `"tb-sheets"` 映射时
   创建前穷举报错;不尝试把 Docker Compose 静默换成基础
   template。
5. **指纹分型。** 改 Compose、build context、template id
   或 materializer revision 都触发重跑;无法解析浮动身份时
   不携带旧结果。
6. **服务失败归因。** sidecar ready 失败或评分前退出得到
   `errored`,artifact 含对应服务日志,不进入 Agent 失败分母。
7. **整组回收。** 部分启动、Ctrl+C、超时与正常结束都不留
   无主资源;支持 group keep 的 case 恢复后重过 ready。
8. **自定义闭环。** 一个 Kubernetes 自定义 case 提供主
   Sandbox、services、身份与 detached cleanup,通过同一套
   能力契约测试。

**反指标**:

- 因为 provider 是 VM 就宣布支持 services,实际文件 API 和
  Agent 位于两个执行空间。
- 核心出现 `provider === "docker"` 分支,而不是消费 case
  返回的 Sandbox 与能力句柄。
- 为了声称 provider-neutral,把 Compose 的 `privileged`、
  volume、network 等字段静默丢掉后继续运行。
- 只实现 `start services`,没有 ready、日志、指纹或强杀
  清理,却把它登记成完整多环境支持。

---

### 和其它方案的关系

- **vs PLAN-1**:保留规范化身份、生命周期和证据义务,否决
  「规范化 OCI 拓扑是唯一契约实体」。本案的通用点是主
  Sandbox 与能力结果,不是所有 provider 共用的构建输入。
- **vs PLAN-2**:Docker case 同样直接消费 Compose,但不把
  Compose agent service 翻译成跨 provider 起点。每个
  provider 自己给 profile 一份完整映射。
- **vs PLAN-3**:服务仍由 niceeval 选中的 environment case
  管理,因此 ready、指纹、证据和回收不外包;只是物化实现
  回到 provider。
- **与 Agent 安装 PLAN-4**:case 先产出主 Sandbox,Agent
  provisioner 再执行检查→必要时安装。官方 Agent template
  是检查命中优化,任务 template 后装 Agent 是同等支持路径。
