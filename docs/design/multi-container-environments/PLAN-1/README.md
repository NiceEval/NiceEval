# PLAN-1 —— 拓扑表:`defineEnvironment`

**相关文档**:[README](../README.md) · [GOALS](../GOALS.md) ·
[LIMITS](../LIMITS.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) ·
[PLAN-4](../PLAN-4/README.md) · [DECISION](../DECISION.md)

---

## 实现方案 1(拓扑表,是否推荐见 [DECISION](../DECISION.md))

### 简述

环境 profile 从「一个起点产物」升格为「一份拓扑」:一个
agent 沙箱、若干服务、一张网。拓扑归一成 niceeval 自己的
规范化数据结构,声明入口有两个——手写 `defineEnvironment`,
或从任务自带的 compose 文件导入(`environmentFromCompose`,
产出同一份规范化拓扑);provider 负责构建与启动。`Sandbox` 接口
一个方法不加,服务是环境的附属事实,不是第二个沙箱。
与 PLAN-2 的根本差异:契约实体是封闭字段集的规范化拓扑,
compose 只是导入来源;与 PLAN-3 的根本差异:服务的生命
周期由 niceeval 接管,有就绪门、日志证据与回收故事。

### 配置形态

eval 侧零改动,仍是不透明 profile id。手写形态:

```typescript
import { defineConfig, defineEnvironment } from "niceeval";

export default defineConfig({
  environments: {
    "tb-sheets": defineEnvironment({
      services: {
        db: {
          image: "postgres:15",
          env: {
            POSTGRES_DB: "sheetsdb",
            POSTGRES_PASSWORD: { fromEnv: "TB_DB_PASSWORD" },  // 值不进指纹、不落盘,变量名两者都进
          },
          ready: { cmd: ["pg_isready", "-U", "postgres"], timeoutMs: 30_000 },
        },
        api: {
          build: { context: "tasks/simple-sheets-put/api" },   // 相对 config 文件;dockerfile / args 可选
          env: { DATABASE_URL: "postgres://db:5432/sheetsdb" },
          dependsOn: ["db"],                                   // db ready 通过后才启动 api
          ready: { tcp: 8000, timeoutMs: 60_000 },             // 从同网探针连,不要求镜像带探针工具
        },
      },
      agentEnv: { API_URL: "http://api:8000" },                // agent 沙箱的环境变量,拓扑知识住拓扑里
    }),
  },
});
```

- `services` 的键是服务名,同时就是 agent 侧可解析的主机名;
  启动期校验合法 DNS label,并拉黑保留字
  (`localhost`、宿主 hostname、provider 元数据域名)。
- `image` 与 `build` 二选一;`build` 是
  `{ context, dockerfile?, args? }`,`context` 以内容哈希
  参与指纹与构建缓存。
- 服务**并行启动**;`dependsOn` 列出的服务全部 ready 后才
  启动本服务(等价 compose 的
  `depends_on: condition: service_healthy`)。因此行为与
  声明顺序无关,指纹不含声明顺序——两者互为前提。
- `ready` 两种形态:`{ cmd }` 在服务容器内以 argv 执行
  (不经 shell、镜像默认用户);`{ tcp }` 由 provider 在目标
  网络里创建临时探针执行。探针与随后创建的 agent 容器使用
  同一网络、DNS 与出口策略,但不依赖尚未存在的 agent 沙箱。
  Docker 用同网的一次性探针容器,VM 内编排也用同网容器,
  不从 runner 宿主或 VM 外部绕路。探针句柄一经取得就纳入
  环境 finalizer,成功、失败与中断路径都删除。轮询 500ms
  起指数退避、封顶 5s;`timeoutMs` 省略时 60s。省略
  `ready` 时容器进入运行态即就绪。
- 容器在 ready 通过前退出即环境失败(`errored`),不做
  restart;ready 通过后到 attempt 结束前退出,同样按
  环境错误终止 attempt,附服务日志。
- `privileged` 声明在**单个 service** 上;agent 沙箱不提供
  特权位——特权 agent 容器在共享 daemon 上能看见并影响
  并发兄弟 attempt,这个隔离面不出让。
- `env` 的值是明文串或 `{ fromEnv }` 间接引用;secrets
  一律走间接形态。

TB 类存量任务的主路径是导入器,不手抄:

```typescript
import { environmentFromCompose } from "niceeval";

export default defineConfig({
  environments: {
    "tb-sheets": environmentFromCompose("tasks/simple-sheets-put/docker-compose.yaml", {
      agentService: "client",            // 这个服务是 agent 容器:剔除,不启动为伴随服务
      env: { T_BENCH_TEST_DIR: "/tests" }, // ${...} 插值取值表;缺键启动期报错
      ignore: ["services.*.volumes"],     // 显式豁免不参与语义的 key
    }),
  },
});
```

导入器把 `healthcheck` 翻成 `ready`、`depends_on` 翻成
`dependsOn`、`build` 翻成 `build`,产出与手写完全同构的
规范化拓扑;未被豁免又不认识的 key 一律启动期报错,不静默
忽略。compose 文件的字节不进指纹,指纹只认规范化拓扑——
与「实验文件认解析值」的既有哲学一致。

`agentService` 只负责指出哪一项要从伴随服务拓扑中剔除,
不把该服务的 `image` / `build` 翻译成 agent 沙箱起点。
agent 起点仍由下面的 provider spec 表选择,构建仍走 provider
原生工具。导入器在返回值里保留一份只供诊断的 agent source
摘要(image 引用或 build context 路径),启动期将它与 spec
解析结果并列展示。

缺少对应 spec 表项时按缺项报错,不得回退到基础产物。这样
迁移者不必人工猜「漏的是哪份 agent 配方」,但导入器也不
冒充跨 provider 构建 DSL。所谓「零手抄」只指伴随服务拓扑,
不包括构建并发布 agent 预制产物。

provider spec 的
[`environments` 表](../../../feature/sandbox/library/prebuilt-environments.md#按-environment-选预制产物)
原语义保留,只翻译 agent 沙箱的起点产物。对齐规则:

- 只有 spec 表项:服务数为零的单容器 profile,现有语义。
- 只有 config 表项:若拓扑来自手写 `defineEnvironment`,agent
  沙箱从 spec 基础产物起步;若来自 compose 导入且剔除了
  `agentService`,启动期报缺少 agent 产物映射,不静默换环境。
- 两处都有:起点产物听 spec 表,服务听 config 表。
- 两处都查不到:启动期配置错误,一次穷举,零沙箱创建。
- `config.environments` 的键对照本次发现到的**全部** eval
  检查,不对照过滤后的选中集合。没有任何已发现 eval 引用的
  键与缺表项同款穷举报错——unused entry 是键名笔误的形状;
  某个键只被未选中的 eval 引用则合法,改变 `evals` 过滤器
  不要求同步裁剪环境表。未发现的动态 eval 不靠猜测放行,
  应先完成 loader 发现再做本校验。

### 优势

- **R1 / R4**:拓扑声明与 provider spec 解耦;服务名即
  主机名,解析是 provider 的构建与启动义务。
- **R2 / R3**:生命周期由 niceeval 编排,就绪门在 agent
  沙箱创建之前,服务销毁在评分之后。
- **R5 / R11**:需求从规范化拓扑纯数据推导(`services` →
  `services` 位;`build` → `imageBuild`;`privileged` 同名);
  `--keep-sandbox` 再追加 `serviceKeep`;全量跳过升级为
  启动期报错,不产出绿色空跑。
- **R6**:指纹输入 = agent 沙箱起点产物 + 规范化拓扑
  (服务名、image 解析后的 OCI digest、build context 内容
  哈希、env 的明文值与间接引用名、command、dependsOn、
  ready)。浮动 tag 只作解析输入,不作环境身份。
- **R7 / R9 / R10**:服务由 niceeval 创建,日志、phases、
  预算口径、回收与孤儿核对都是顺理成章的义务(见下节)。
- **R8**:导入器让 TB 类任务零手抄,compose 保持单一事实源;
  手抄漏译一个 healthcheck 参数就是新的「推导有洞」,
  导入器把这类错误整类关掉。
- 与[无跨 provider 构建 DSL](../../../feature/sandbox/library/prebuilt-environments.md#为什么没有跨-provider-构建-dsl)
  相容:服务不是发布产物,是运行期容器;agent 沙箱起点仍
  只认 typed 产物 ID。

### 缺点

- niceeval 多了一类要长期维护的声明词汇与一个 compose
  子集导入器;compose 语义随上游演进,豁免白名单要跟。
- 工程量三案最大:调度口径、回收契约、留存扩展、
  孤儿核对扩展、证据 registry 都要动(见下节)。
- 拓扑的运行载体事实上全是 OCI 容器;不以容器为原语的
  未来 provider 接不上 `services` 能力,只能 `skipped`。

---

### 架构 / 数据流

```text
(取得并发位后)
createEnvironment(provider, profile)
 ├─ 建网                                  # 每 attempt 一张,服务名在网内可解析
 ├─ 服务并行启动,按 dependsOn 排闸         # 就绪门:ready 全过才继续;失败 → errored
 └─ agent 沙箱创建,入网                    # ← 从这里起完全是现有生命周期链,一步不变
 → sandbox.setup → baseline → eval.setup → agent.setup
 → test(t) → workspace.diff
 → scoring.evaluate                        # ← 服务此刻仍活着
 → eval / agent / sandbox teardown
 → 服务日志采集 → 服务销毁 → 拆网
```

**调度与计时口径(R10)。** 构建所需 image、创建网络、启动 Sandbox 与服务并等待 ready发生在取得并发位之后;
attempt deadline 与携带资格的 `executionMs` 起算点从
`sandbox.create` 前移到 `createEnvironment`,
[缓存契约](../../../feature/experiments/cache.md)同步改。
镜像拉取与构建各带显式上限,不存在不受任何超时约束的阶段。
新 `LifecyclePhase` 成员(建网、逐服务启动、ready 等待、
日志采集、销毁、拆网)的插入位置与 `durationMs` 口径随
[Record 闭集](../../../feature/record/architecture.md#resultjson)
一并定稿。

**回收契约(R9)。** 构建所需 image、创建网络、启动 Sandbox 与服务并等待 ready整体纳入
[Provisioning 失败与重试](../../../feature/sandbox/architecture.md#provisioning-失败与重试):

- 服务容器**与网络**创建期打同一套 provision token 与
  运行标识(docker 网络支持 label)。
- kill-on-failure 覆盖部分启动的拓扑:拿到任一句柄后失败,
  先整组销毁再抛原始错误(db 起了、api ready 超时,
  db 与网络不留)。
- 拉服务镜像限流沿用拒绝类退避;确定性构建失败按共享该
  profile 的范围附
  [`scope`](../../../feature/error-classification/README.md)
  给止损闸,不让 30 条同 profile 的 attempt 各烧一遍。
  同 content-hash 的并发构建做进程内 single-flight。
- 孤儿核对与 `sandbox prune` 的资源词表加「服务容器」
  「网络」两行;中断与留存矩阵覆盖构建 image、创建网络、启动 Sandbox 与服务以及等待 ready 时的 Ctrl+C。
  此刻沙箱 Scope 尚不存在,清理由各阶段自己的 finalizer 承担。

**能力协商与 skipped(R5 / R11)。** 供给侧是 provider
中性元数据的能力位(与 `exclusive` 同层),解析期取交集:

- 缺项的 (eval, provider) 组合逐 attempt 落
  `verdict: "skipped"`,`skipReason` 用
  `environment-unsupported: <能力位>` 词表,无 `sandbox`、
  `phases` 为空;不进通过率分母,报告单列。
- 选中集合**全部**因能力缺项跳过时升级为启动期报错——
  与 local × keep 等「组合永远跑不了就创建前报错」的
  既有先例同响度,CI 不产出绿色空跑。

**构建并启动。**

- **Docker**:每 attempt 一张 bridge 网络 + 容器别名。
  daemon 默认地址池只够约 30 张网,并发派发对网络配额做
  与并发位同款的有界申请,文档写明 `default-address-pools`
  调法;kept 现场占用的网络计入 `sandbox list` 可见账目。
- **E2B / Vercel**:VM 只当宿主,**agent 也进容器**、与
  服务同网——agent 与 docker daemon 同权的话,「经 api
  写 db」这类题可以 `docker exec` 直写 db 绕过被测路径,
  判分面跨 provider 系统性分叉。服务名走网络 DNS,不用
  `/etc/hosts`(服务重启换 IP 即陈旧)。能力位默认关,
  真机验证后打开;`imageBuild` 云侧另行验证(逐 VM 零
  构建缓存,成本故事没讲清前不开)。
- **Local**:不启动伴随服务,一律 `skipped`。

服务声明里的 `image` 可以写 tag 或 digest。规划期由 provider
按目标平台把 tag 解析成不可变 OCI manifest digest。规范化
拓扑、指纹与 `run.json` 投影都记录 digest;同一 tag 被重推
会得到新指纹。解析发生在携带决策之前,失败是环境解析错误,
不能拿旧结果假装命中。
`build` 不先构建再算身份,它继续以 context 内容、Dockerfile
与 args 的规范化哈希作为指纹输入;构建产出的 digest 另作为
运行事实落盘,用于事后核对。provider 若不能解析不可变身份,
不得声明 `services` 能力。

**证据(R7)。** 服务日志进
[证据 registry](../../../feature/record/architecture.md)新行
`service-logs`:逐服务分文件、尾部截断带体积上限、publish
默认携带、词干进 `AttemptRecord.artifacts`;采集沿用 timing
记录的脱敏纪律(env 值不回显进摘要)。

**指纹与 secrets(R6)。** `{ fromEnv }` 的变量名进指纹与
落盘投影,值两者都不进——密钥轮换不触发重跑,与
[judge 凭据的既有裁决](../../../feature/experiments/cache.md)
同构;`run.json` 的拓扑投影只落 env 的 key 清单与间接
引用名,明文值不落盘。

**留存。** `--keep-sandbox` 对带服务的 attempt 留存整组
(agent 容器 + 服务容器 + 网络),注册表条目扩 `services`
与 `network` 字段,`state` 逐成员记录。提交 keep 后的状态
转换由 provider 原子地对整组执行,不允许只暂停 agent:

- Docker 按反向 `dependsOn` 顺序停止服务,再停止 agent,
  保留容器可写层与网络;`enter` 先按依赖顺序启动服务并重过
  ready 门,再启动并进入 agent。恢复失败保留登记项并退出
  非零,不得把半恢复的整组标成 `"alive"`。
- E2B 暂停承载整组的 VM,容器、网络与内存一起冻结;恢复 VM
  后仍逐服务核对 running 与 ready,核对通过才进入 agent。
- Vercel 只有验证出可恢复容器、网络与服务数据的实现后才开
  独立能力位 `serviceKeep`;只有 `services` 而没有
  `serviceKeep` 时,与 `--keep-sandbox` 的组合在创建前报错。

`sandbox stop` 销毁整组并拆网,少销毁任何成员都算失败并保留
登记项。ready 失败的 `errored` 不留存——agent 沙箱从未创建,
登记项没有可进入的锚点;服务日志 artifact 是该场景的唯一
证据,这句写进 keep 文档。

**复用。** [Sandbox 复用](../../../feature/sandbox/reuse.md)
本就按 profile 分组;带服务的组不参与复用、逐 attempt
新建,其余组照常——不整场报错,报错只在用户显式把带服务
组塞给复用语义时出现,文案给出拆分修法。

---

### 落地路线

1. 规范化拓扑类型、`defineEnvironment`、镜像 digest 解析与
   两表对齐,启动期穷举报错(含 unused key、保留字、全 skipped)。
2. Docker 构建并启动:网络与配额、并行启动 + `dependsOn` 排闸、
   ready 门、回收契约接入、phases 扩词、日志证据行。
3. 能力协商与 `skipped` 落盘形状。
4. 指纹扩展(含 `fromEnv`)与缓存口径前移、回归测试。
5. 留存整组与孤儿核对扩展。
6. `environmentFromCompose` 导入器(子集白名单 + 插值表)。
7. E2B / Vercel 真机验证(agent 进容器形态)后开能力位。

---

### 验收 / Definition of Done

1. **依赖排闸(R2)**:`api dependsOn db` 的拓扑,db ready
   前 api 不启动;db ready 恒失败时 attempt `errored`、
   api 从未启动、网络与 db 已回收。
2. **判分时服务活着(R3)**:`test(t)` 最后一步与 judge
   阶段各发一次服务请求,全部成功。
3. **服务名解析(R4)**:同一条 eval 在 docker 与(验证后
   的)e2b 上用 `http://api:8000` 均可达,eval 零改动。
4. **skipped 与假绿(R5 / R11)**:带服务 profile 跑 local,
   部分命中时逐 attempt 落 `skipped` 并单列;选中集合全部
   跳过时启动期报错、退出非零。
5. **指纹(R6)**:改 `build.context` 内任意文件触发重跑;
   同一服务 tag 重推到新 manifest 也触发;只改服务声明顺序
   不触发;轮换 `fromEnv` 指向的密钥值不触发。
6. **证据(R7)**:失败 attempt 的 artifacts 里有逐服务
   日志,超上限时尾部截断而不是撑爆目录。
7. **导入器(R8)**:已有对应 provider agent 预制产物映射时,
   真实 TB compose 只写 `agentService` 与插值表即可导入
   伴随服务并跑通;缺 agent 映射时启动期同时展示 compose
   agent source 与待补的 spec 表项。含未认识 key 的 compose
   启动期报错并点名字段。
8. **回收与留存(R9)**:Ctrl+C(含 ready 等待期)后无残留
   容器与网络;SIGKILL 后孤儿核对能列出并收回整组。Docker
   留存后 `enter` 会依赖有序地恢复服务、重过 ready 门再
   进入 agent;恢复失败时登记项仍可见。
9. **口径(R10)**:首轮构建 10 分钟的 attempt,deadline 与
   `executionMs` 都覆盖这 10 分钟;第 31 个并发 attempt
   在网络配额上排队而不是成片 `errored`。

**反指标**:

- 服务起了但就绪门被跳过(容器 running 即放行),判分阶段
  偶发 ConnectionError。
- `skipped` 进了通过率分母,或全 skipped 的 run 在 CI 里
  绿灯。
- 留存现场只有 agent 容器,enter 后复现不了失败。
- Docker 留存时服务继续运行占资源,或恢复时没重过 ready 门
  就进入 agent。
- e2b 上 agent 能 `docker exec` 进服务容器——判分面与
  Docker provider 不对等的假 `passed`。

---

### 和其它方案的关系

- **vs PLAN-2**:PLAN-2 的 compose 解析以导入器身份并入
  本方案(同一份规范化拓扑);被否决的只是「compose 直接
  作为运行时契约实体」。
- **vs PLAN-3**:PLAN-3 的能力协商切片是本方案落地路线的
  第 3 步,可先行;PLAN-3 同时是「provider 无 `services`
  能力」时的用户侧退路。
