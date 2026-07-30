# 多容器环境 —— 结论

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) ·
[PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md)

---

## 待复审候选

[PLAN-4](PLAN-4.md) 在本结论之后新增。它保留公共主
Sandbox 与完整生命周期义务,但把环境输入和物化收回各
provider 的 environment case;现有 PLAN-1 结论尚未据此
重裁。复审时应重点判断:规范化 OCI 拓扑是否必须是唯一
契约实体,还是「profile 名中性、provider 映射原生」已经
足够通用。

## 结论

采纳 [PLAN-1](PLAN-1.md)(拓扑表)作为运行时形态,规范化
拓扑是唯一契约实体;[PLAN-2](PLAN-2.md) 的 compose 解析以
导入器身份并入(`environmentFromCompose`,TB 类存量任务的
主路径);[PLAN-3](PLAN-3.md) 的能力协商切片与
[Agent 进程契约](../../roadmap/agent-process-contract/README.md)
先行落地。

结论经过一轮正反双向评审:正方拿三个真实 TB 任务
(simple-sheets-put / fibonacci-server / download-youtube)
逐题落地压测,反方对照十篇既有契约做红队攻击。
评审确认的修正已并入 PLAN-1 正文,要点:

- 环境物化纳入并发位与 deadline 口径(R10)。
- 服务与网络纳入 provisioning 回收与孤儿核对契约(R9)。
- 服务并行启动、`dependsOn` 显式依赖,就绪前退出即
  环境失败。
- tcp 就绪检查由同网临时探针执行,不依赖尚未创建的 agent。
- secrets 走 `{ fromEnv }` 间接形态。
- 浮动服务 tag 先解析为 OCI digest,实际内容进入指纹。
- 全量 `skipped` 升级为启动期报错(R11)。
- 云 provider 形态改为 agent 进容器与服务同网,消掉判分面
  跨 provider 不对等。
- 留存按整组暂停与恢复;不能恢复整组的 provider 不开放
  `serviceKeep` 能力。

评审过程台账见
[memory 条目](../../../memory/multi-container-design-review-ledger.md)。

## 依据

- **R1–R7、R9–R11** 只有 PLAN-1 全数满足:规范化拓扑是
  封闭字段集,指纹、能力推导、就绪门、预算口径、回收与
  留存都对着同一份纯数据定义。
- **R8** 由导入器补齐伴随服务侧:真实 TB compose 依赖
  harness 注入变量、且要剔除 agent 容器服务,任何形态都
  躲不开一层预处理。显式导入器(未认识字段一律报错)把
  compose 全集的契约无底洞收敛成可枚举白名单;compose
  保持伴随服务拓扑的单一事实源,手抄漏译的整类错误关掉。
  agent 沙箱起点仍听 provider spec,导入器只展示 compose
  agent source 与缺失映射,不承诺替用户构建跨 provider
  预制产物。
- 下游落地验证确认:eval 侧零改动的承诺兑现;「服务缺席」
  「判分时进程死亡」「限流退出码固化」三类假结论分别由
  能力协商、进程寿命契约、非零退出契约消灭;先行分期的
  排序被证据支持。

## 否决的候选项

- **PLAN-2(compose 作为运行时契约实体)**:子集边界成为
  永久契约面、指纹口径被外部规范牵着走、`agentService`
  与「起点产物听 provider 词汇」冲突。依据是
  [LIMITS · compose 规范体量](LIMITS.md#共通限制)与
  GOALS R6。其迁移优势被导入器完整继承,故只否决
  「直接作为契约实体」,不否决 compose 来源本身。
- **PLAN-3(仅外部编排)**:R2 / R3 / R6 / R7 / R9 / R10
  结构性缺席——服务中途死亡仍产出假 `failed` 并被缓存
  固化,外部服务不进指纹、预算与清理故事。云 provider
  形态残缺(VM 内 agent 访问不到宿主机编排的网络)。
  作为终态被否决;其能力协商切片作为先行分期保留。

## 遗留风险

- **E2B / Vercel 的 VM 内 docker 未经真机验证**:agent 进
  容器形态、daemon 权限、`imageBuild` 的逐 VM 构建成本都
  待验证。验证不达标则云侧 `services` 能力位长期关闭,
  多容器题在云上恒 `skipped`,届时评估是否值得做云侧
  原生多实例组网。
- **Docker 网络地址池上限**:默认 daemon 配置约 30 张网,
  高并发批跑靠网络配额排队 + 文档写明
  `default-address-pools` 调法;kept 现场占坑计入可见
  账目。撞上限的频率若高于预期,考虑网络复用形态。
- **浮动 tag 解析依赖 registry**:携带规划前要取得 OCI
  digest,私有 registry 的凭据、限流与离线行为会进入环境
  解析失败面。不能解析时宁可报错,不退回只哈希 tag。
- **agent 沙箱镜像推导仍在边界外**:单容器题的派生镜像
  构建归下游脚本,「翻译有洞」在 agent 侧只被 unused-key
  报错部分缓解;TB 类下游再次撞洞时,重议 agent 沙箱的
  Dockerfile 入口(当前否决理由:破坏发布产物的版本锁定
  与可比性)。
- **进程寿命契约的逐 provider 一致性**:义务是否真被履行
  要靠契约探针(后台进程存活检查)守护,探针纳入 provider
  义务测试与模板发布门槛;真机行为与文档不符时,以探针
  红灯为准收窄能力位。
