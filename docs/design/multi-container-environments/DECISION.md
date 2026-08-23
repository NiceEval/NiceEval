# 多容器拓扑 —— 裁决

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) ·
[PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) ·
[真题落地样例](PLAN-4/use-case/README.md)

---

## 裁决

定稿契约的完整正文在 Feature,本篇只保留选型理由:
[Sandbox 定义](../../feature/sandbox/case.md) ·
[Record · 两层时间模型](../../feature/record/architecture.md) ·
[Experiments · Run 级共享准备](../../feature/experiments/architecture.md#run-级共享准备构建协调的预算) ·
[Eval · 文件夹入口](../../feature/eval/README.md#文件夹入口一道题一个目录)。

采纳 **PLAN-4(能力分型)**:公共契约是唯一的主 `Sandbox`
加可选能力句柄;Sandbox 输入与构建并启动收在各 provider 的
`SandboxCase` 里。每种公开的 case 给齐启动、就绪、判分、
证据、指纹、回收与留存的完整义务。Docker 原生消费 Compose,
E2B 消费 template,云端 Compose 只在兑现全部义务后开放。

本裁决推翻此前「采纳 PLAN-1(拓扑表)」的裁决。决定性证据
是[真题落地样例](PLAN-4/use-case/README.md)的四道 TB 题:named volume、
一次性初始化容器、只读卷投影、坏 `dns` / `extra_hosts`
本身就是题面。规范化拓扑的封闭字段集要么表达不了这些,
要么靠豁免白名单改掉题目语义;导入器则会被 Compose 上百个
字段逼成一个永远追上游的 parser。「provider 中性的唯一契约
实体」换不来对真题的命中范围,换来的是把每家 provider 的原生能力
削到最小公倍数,与 [GOALS](GOALS.md)「原生能力做到最大」
原则相悖。

跨 provider 可迁移不是本决策的承诺。每个 provider 像
adapter 一样单独成篇文档,声明自己支持的 `SandboxCase`
目录与能力位;同一 profile 在两家 provider 是否可比,由
项目裁定并以实际 case 的身份登记。

## 随本裁决一并裁定的三点

PLAN-4 正文遗留的含糊处,按下面裁定并已写回
[PLAN-4](PLAN-4/README.md):

- **部分不支持判什么**:分两类。eval 引用了不存在的
  profile 键、或 source 声明本身非法,是启动期配置错误,
  一次穷举。映射与声明合法、但当前 provider 缺对应
  Sandbox source builder 或能力位,是能力缺失——该组合零沙箱创建、
  计划期 `skipped` 并写明缺项;选中集合全部 `skipped` 时
  升级为启动期报错。与 R5 / R11 对齐。
- **配置面两个入口**:SandboxSpec 的 `environments` 表按
  profile 名映射完整 case;`materializers` 表按 source kind
  注册 folder-local 声明的 Sandbox source builder。同一 profile 两处都命中
  时显式 `environments` 表项优先——这就是 provider 让
  预建输出优先于按需构建的口子。
- **命名:Environment 只留给 eval 侧的轴**。
  `eval.environment` 字段、profile 名与 `environments` 表键
  继续叫 environment——它们回答「这条 eval 在哪个题目 Sandbox
  里跑」,且 eval 不选 provider。provider 侧的实现实体一律
  用 Sandbox 词族:
  - 内置 case 不导出构造函数:`environments` 表值是
    provider 原生纯数据,靠 `{ template }`、`{ build }`、
    `{ compose }` 这类判别键区分,类型由 spec 工厂参数给出
    (如 `E2BSandboxCase`)。表值已在该 provider 工厂的
    括号里,再挂 provider 前缀构造函数是把 provider 说两遍,
    还平白多出要过调用点评审的导出名;
  - 保留构造函数的只有真需要函数的两处。eval 侧
    `composeSandbox`:中性 source 声明,要从 eval 目录推导
    默认 profile 并 brand 防同形误换;`defineSandboxCase`:
    携带 `materialize` 行为。source builder 工厂照旧;
  - 内部实体 `SandboxCase`,注册表条目 `SandboxGroupEntry`;
  - 身份 key 的正式名就是 `BuildKey` 与 `CaseKey`,run 数据
    字段叫 `sandboxBuilds`。

  理由:Environment 此前同时指轴、实体、key 与注册表四样
  东西,是口袋词;拆开后轴名回答「哪个 Sandbox」,Sandbox 词族
  回答「怎么起、在哪跑」。

## 依据

- **R1–R7、R9–R11**:PLAN-4 保留了 PLAN-1 裁决里全部硬
  义务——就绪门、判分时存活、指纹、证据、预算口径、整组
  回收与留存。变化只在义务的承担单位:从「唯一拓扑实体」
  换成「每种 case」。义务清单在 PLAN-4 的各 case 节与验收
  节逐条可查。
- **R8**:Docker case 原生消费 Compose 后,「支持 compose」
  的契约面从追上游的白名单反转为一张小黑名单(挂 socket、
  脱管网、替换受管 workdir)。题目语义字段(`dns`、
  `extra_hosts`、volume、依赖条件)原样生效,手抄漏译整类
  消失,还省下一个 parser 的长期维护。
- **agent 沙箱镜像推导的旧遗留风险随之关闭**:逐题
  Dockerfile 是 `SandboxCase` 的一等输入,BuildKey /
  CaseKey 自动追内容。配合
  [Agent 安装配方](../agent-install-recipe/DECISION.md)的
  Ensure 协议,题目输出不必预烘 Agent,「题目 × Agent」
  image 或 template 组合矩阵不存在。两个主题的 PLAN-4 互为前提,一起采纳。

上一轮对 PLAN-1 的正反双向评审
([memory 复盘](../../../memory/multi-container-design-review-ledger.md))
裁决继续有效,修正项按新形态安置。清单:预算与 deadline
口径、整组回收与孤儿核对、并行启动与依赖准入控制、浮动 tag
先读取 digest、`fromEnv` 间接 secrets、全量 `skipped`
升级报错、整组留存原子性。这些义务由各 case 承担;
Docker case 直接
复用 Compose 的依赖与健康检查语义,兑现其中就绪与准入
两条。

## 否决的候选项

- **PLAN-1(拓扑表)**:否决「规范化 OCI 拓扑是唯一契约
  实体」。它的硬义务全数保留(见上);被否决的是「所有
  provider 共用同一份构建输入」这个通用点——真题证明该
  通用点表达力不足,且与原生能力最大化冲突。
- **PLAN-2(compose 作为 niceeval 读取的契约实体)**:维持
  否决,但三条否决理由的命运不同,逐条交代:
  - 子集白名单是永久契约面——仍成立;PLAN-4 用「不读取、
    只列黑名单」避开。
  - 运行时依赖 `docker compose` CLI——原缺点被 PLAN-4
    接受,作为 Docker provider 的原生依赖合法住在
    provider 侧。
  - `agentService` 接管 agent 沙箱起点——被 PLAN-4 加
    Ensure 协议整体翻案:mainService 就是从题目 Compose
    现场构建的主 Sandbox,Agent 由 Ensure 后装。
  - PLAN-2 曾用 `composeEnvironment({ agentService })` 命名
    其读取子集的 config 实体。PLAN-4 的同类声明按上面的命名
    裁决定名 `composeSandbox({ mainService })`,是不承诺
    读取、交给 Sandbox source builder 的 source 声明;两者不同物,
    名字也不撞。
- **PLAN-3(仅外部编排)**:作为终态维持否决,R2 / R3 /
  R6 / R7 / R9 / R10 结构性缺席的论证不受本次改判影响。
  其能力协商切片被 PLAN-4 换形状继承:协商输入从 profile
  上的 `requires` 抽象标签,换成「source kind × 当前
  SandboxSpec 有无对应 Sandbox source builder / case」;`requires`
  标签退出待实现清单。外部编排继续作为 provider 无对应
  case 时的用户侧退路。

## 遗留风险

- **E2B / Vercel 的 VM 内 docker 未经真机验证**:DinD 的
  daemon 权限、嵌套开销、文件 API 代理进 main 容器的可行性
  都待验证。验证不达标则该 provider 不声明 Compose 能力,
  多容器题在其上 `skipped`;届时评估 Pod 或原生组网路线。
- **Docker 网络地址池上限**:默认 daemon 配置约 30 张网,
  高并发批跑靠网络配额排队 + 文档写明
  `default-address-pools` 调法;kept 现场占坑计入可见账目。
  撞上限频率高于预期时考虑网络复用形态。
- **浮动 tag 不提供自动失效证明**:Provider 能读取 OCI digest 时把它作为
  Sandbox 事实登记；读取失败时保留原始 tag 作为声明身份，不阻断历史终态携带。
  同名 tag 后来指向不同内容时 Runner 无法自动观察，作者需改变声明、提升
  revision，或使用 `--rerun all` 明确重验。
- **Compose 上游语义面**:直接消费 Compose 意味着接受其
  演进;niceeval 只对自己注入的 overlay 与黑名单里的安全
  不变量负责,不承诺解释任意 Compose 行为。上游新增字段
  破坏核心不变量时补黑名单项,属于常态维护。
- **逐 provider 文档义务**:「每个 provider 一篇、写明
  case 目录与能力位」是本裁决的收尾义务;文档缺位会让
  「诚实的能力边界」退化成用户眼里的随机不支持。
- **进程寿命契约的逐 provider 一致性**:义务是否真被履行
  要靠契约探针(后台进程存活检查)守护,探针纳入 provider
  义务测试与模板发布门槛;真机行为与文档不符时,以探针
  红灯为准收窄能力位。
