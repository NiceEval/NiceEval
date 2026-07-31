# PLAN-2 —— 中间件拆分:`withCodingAgent`

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-3](PLAN-3.md) ·
[PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 实现方案 2(中间件拆分,是否推荐见 [DECISION](DECISION.md))

### 简述

把「装 agent CLI」从工厂里拆成与契约层同形态的导出中间件,
`withNodeToolContract` 一并公开;工厂退化为组合糖,语义
不变。契约层已经是 `TemplateBuilder => TemplateBuilder`
的可叠加形态([LIMITS](LIMITS.md)),本案补齐唯一还焊在
工厂里的一段:

```typescript
// Case A:工厂即组合糖,对外一字不改
e2bCodingAgentTemplate("codex")
// ≡ verifyE2BNodeToolContract(
//     withCodingAgent(
//       withNodeToolContract(Template().fromTemplate(官方基线)),
//       "codex"))

// Case B:同一批中间件叠到任务给定的起点 OCI image 或 E2B template上
const template = verifyE2BNodeToolContract(
  withCodingAgent(
    withNodeToolContract(
      Template().fromImage("ghcr.io/laude-institute/t-bench/ubuntu-24-04:20250624")),
    "codex"));
```

`withNodeToolContract` 同步长出任意 OCI image 或 E2B template能力:探测 Node、
缺失时安装锁定版本的 Node、声明 apt 支持面、范围外构建期
报错(这一步与 PLAN-1 共享,是 Case B 的真实成本)。

### 优势

- **R1 达成**:起点 OCI image 或 E2B template任意换,契约与安装配方都住在 niceeval,
  下游零手抄、自动跟随。
- **R2 满分**:工厂签名与产出不变,实现改为调用同一批
  中间件——Case A 与 Case B 走同一份代码,不是两条平行
  实现。
- **R3 达成**:支持面声明在 `withNodeToolContract`,
  `verifyE2BNodeToolContract` 在构建期把违例拦下,校验链
  既有机制直接复用。
- **R5 部分达成**:中间件形态本身就是自定义口子——用户为
  未内置的 agent 写自己的
  `TemplateBuilder => TemplateBuilder`,与内置中间件同法
  叠加、同法过校验;构建期这一半的自定义不需要 niceeval
  内置。
- 组合语义摊在调用点上,每层各管一事,没有选项组合的
  隐藏契约面。

### 缺点

- 公开面变大:`withCodingAgent` 与 `withNodeToolContract`
  成为公开 API,按
  [API 设计契约](../../api-design.md)要走调用点评审,契约
  变更从此有兼容义务。
- **R4 不达成**:构建期配方独立存在了,但 adapter 运行时
  回退安装仍是另一份实现,改安装命令还是两处。
- **R6 不达成**:中间件是 E2B builder 词汇,Docker 用户
  引用不到;Node 工具契约对 Dockerfile 仍无出处。
- 自定义 agent 的运行时半边(回退安装、指纹检测)没有
  口子,R5 只覆盖构建期。

---

### 架构 / 数据流

```text
niceeval/sandbox/e2b-template 公开面
 ├─ withNodeToolContract(t)        起点 OCI image 或 E2B template → 契约化起点 OCI image 或 E2B template(探测 Node/补 Node/apt 支持面)
 ├─ withCodingAgent(t, agent)      契约化起点 OCI image 或 E2B template → 含 agent 的模板(读共享版本常量)
 ├─ verifyE2BNodeToolContract(t)   构建期断言(既有)
 └─ e2bCodingAgentTemplate(agent)  上面三层的组合糖(既有签名)
```

`withCodingAgent` 只假设契约、不假设起点 OCI image 或 E2B template:它读的每个路径
与权限都由 `withNodeToolContract` 建立、由 verify 断言,
顺序错放(未过契约层直接装)在构建期报错。

---

### 落地路线

1. `withNodeToolContract` 任意 OCI image 或 E2B template模式(与 PLAN-1 第 1 步
   相同)。
2. 从工厂函数体析出 `withCodingAgent`,工厂改为组合调用;
   既有单测与公共基线构建脚本回归。
3. 导出与 TSDoc,`pnpm docs:reference` 重新生成参考页。
4. TB 任务 image冒烟:八道卡住的题跑通。
5. 重写
   [预制环境](../../feature/sandbox/library/prebuilt-environments.md)
   E2B 节与 docs-site 教程,按三轴模型分 Case 叙述。

---

### 验收 / Definition of Done

1. **起点 OCI image 或 E2B template 可换(R1)**:简述里的 Case B 代码建出模板,
   attempt 里任务依赖与 codex 同时可用。
2. **Case A 不回归(R2)**:既有构建脚本不改重跑,模板
   行为与拆分前一致。
3. **支持面显式(R3)**:Alpine 起点 OCI image 或 E2B template构建期报错点名包管理
   器;跳过 `withNodeToolContract` 直接 `withCodingAgent`
   同样构建期报错。
4. **自定义构建期口子(R5 构建期半边)**:用一个未内置的
   agent 写用户侧中间件,叠加、过校验、建出模板。

**反指标**:

- 工厂与中间件两条路径产出的模板行为有差异——说明工厂
  没有真正退化为组合糖,Case A/B 又变回平行实现。
- 契约校验只在官方基线路径上跑——`fromImage` 路径建成
  静默坏模板,回到 README 描述的坏法。

---

### 和其它方案的关系

- **vs PLAN-1**:同一步契约层扩展,差异在暴露形态;本案
  能力面是 PLAN-1 的超集,PLAN-1 不构成向本案的台阶
  (选项参数一旦公开就有兼容义务,再拆中间件要背两副
  契约)。
- **vs PLAN-3**:本案是 PLAN-3 的第一段——配方先独立
  存在,才谈得上单源双执行时机;PLAN-3 的触发条件见
  [DECISION](DECISION.md)。
