# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [EVIDENCE](EVIDENCE.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md)

## 结论

采纳 [PLAN-2](PLAN-2/README.md)：用户任务规格与类型化可观察读面。

测试体系增加一条与执行层正交的作者轴：

- **行为主证明**面向 niceeval 用户。
  它同时引用既有用户任务与 Feature 契约，从公开能力进入，并按对象身份断言用户结果。
- **机制证明**面向实现维护者。
  它证明调度、时钟、锁、转换与代数定律，可以使用精确内部词汇。
- 每个用户行为恰有一个主证明；主证明可以同时观察多个媒介。
- 公开入口、观察媒介与真实边界分开声明，不能用一个 `surface` 枚举混装。
- 必需真实边界由 Behavior 显式声明，不能因 unit 主证明通过而省略。
- 主证明和每个必需边界证明都必须产生自己的带来源、提取路径和对象身份的运行 outcome。
- 机制证明只在有诊断价值时补充。
- 两类证明仍分别执行在 unit 或 E2E，不增加第三层。

PLAN-1 的语义 JSON / XML matcher、ARIA、Playwright role locator、显式 PTY 和场景元数据，作为 PLAN-2 可观察读面的内部适配器采用。
不采用 PLAN-1 以媒介 matcher 为测试作者的最终入口。

## 对照

| 判据 | PLAN-1 | PLAN-2 | PLAN-3 |
|---|---|---|---|
| G1：一屏读懂用户任务 | 部分；测试仍按实现目录散落 | 满足；行为规格按任务组织 | 满足；Case 最紧凑 |
| G2：标题与证明强度一致 | 主要靠 matcher 与 review | typed identity + review | claim 结构可守护 |
| G3：机制证明保持精确 | 满足 | 满足 | 满足，但 Projection 容易过度抽象 |
| G4：Feature 语义单源 | 满足 | 满足 | 满足，但 Case 模型最接近第二份契约 |
| G5：独立 oracle | 能满足 | 能满足 | 取决于 driver 是否成为影子实现 |
| G6：变化预算 | 媒介跟改下降，行为与机制仍混排 | 行为、机制、transport 分责 | 理论最强，领域联合变化会批量跟改 |
| G7：定位与单例重跑 | 元数据改善诊断 | Behavior + world 直接定位 | 信息最全，但跳转最多 |
| G8：真实边界与确定性 | 保留 | 保留 | 保留，但需要两套 Projection |
| G9：增量采用 | 最容易 | 可从两个高风险域试点 | 采用门槛最高 |

PLAN-2 是唯一同时明显改善用户阅读路径，又不要求先建立第二套声明模型的候选。

## 为什么选择 PLAN-2

### 对 G1、G2：正文直接表达用户结果

类型化可观察读面以 `run.attempt("kept")`、`report.table("Comparison")` 和 `attemptDialog(id)` 这类对象为入口。
这些对象返回不透明 `Observed<T>`，保留原始 evidence、提取路径与业务身份；matcher 才能读取并登记 outcome。
测试无法只写“剩一行”就声称“只留下 main”，也无法只写“有 modal”就声称“打开了目标 attempt”。
跨媒介关系逐字段书写，不允许 `semanticValues()` 一类隐藏比较口径。

### 对 G3：不牺牲机制证明

行为规格不接管低层测试。
Runner 的锁、并发、重试和超时仍可以直接展示 barrier、事件序列与 `TestClock`。
它们只在能帮助诊断时关联 Behavior ID，不必伪装成 Given / When / Then。

### 对 G4、G6：只登记用户行为

稳定 ID 绑定用户任务、契约、一个主证明与明确要求的真实边界，而不是绑定约 1,900 条测试。
Feature 契约仍是语义单源；测试只保存契约链接、证明身份与观察结果。

内部重构可以只改机制证明。
公开行为变化才要求调整行为规格和边界证明，因此变化预算有明确归属。

### 对 G5、G8：适配器不拥有预期

终端、JSON、XML、ARIA 与浏览器适配器只把真实输出变成带 provenance 的可观察对象。
对象身份、状态和期望值由测试侧独立声明，不能从候选 renderer 或 schema 导入。

## 为什么不选其它候选

### PLAN-1

[PLAN-1](PLAN-1/README.md)迁移最小，也足以修复 registry 粒度和一部分脆弱字符串断言。
但测试正文仍会被 `section`、`row`、`line`、regex 与 DOM locator 占据。

它能让媒介合同更稳定，却不能稳定地回答“用户完成了什么任务”。
因此它适合作为适配器落地阶段，不适合作为最终作者面。

### PLAN-3

[PLAN-3](PLAN-3/README.md)最容易生成目录、矩阵和多 driver 报告。
代价是为 niceeval 再建立一套 World、Action、Outcome 模型。

一旦两个 driver 需要分支，声明就会退化成隐藏的测试程序；一旦追求所有媒介复用，unit 与 E2E 又会被最低公分母焊在一起。
跨自治仓库又只能连接 native proof，不能凭 Case ID / digest 执行 claim，因此它并没有消除跨仓语义重复。
现有跨媒介重复还不足以证明这笔抽象成本。

## 现有 E2E Acceptance DSL 的处理

[`docs/roadmap/e2e-acceptance-dsl/`](../../roadmap/e2e-acceptance-dsl/README.md)不再作为全仓测试作者面的候选终态。
它保留为 Report 可观察读面的适配器设计输入，并需要先修正十项边界：

1. `term()` 明确区分 non-TTY 语义输出与 PTY screen，不靠框线字符推断 plain stdout；PTY evidence 固定为 invocation、终态 cell grid、scrollback、raw ANSI、resize 与退出信息。
2. JSON 与 JUnit 改为结构语义比较，golden 只留给逐字承诺的短文本。
3. prepare 之后所有普通验收只读；冻结由原子发布、路径守卫、权限和前后文件树 digest 强制，会迁移或追加结果的场景使用单例私有 clone。
4. `section`、`row`、ARIA 与 locator 降为内部适配器；测试正文使用 Report 领域对象并保留 `Observed<T>` provenance。
5. ARIA 固定由 Playwright + 真实 Chromium 产生，每例全新 BrowserContext / Page；静态 HTML 禁用 JS 且只准本地网络，交互 proof 才启用 JS；producer identity 与 verifier identity 分开记录。
6. 真实协议 usage 比较同次调用的上游公开事件与 niceeval 公开出口，不签入易漂的固定 token 数。
7. 每个 E2E proof 显式绑定 `evidenceRecipeId` 与 read-only / mutable-clone 模式，不能靠目录或顺序猜 world。
8. candidate、recipe、producer symbol closure、fixture、外部依赖、producer environment 与 verifier 各自摘要，改 matcher 不让 world 误过期，改 prepare helper 也不能误复用。
9. `scripts/e2e.ts` 唯一解析 `verify --world ... --behavior ...`；身份不匹配时拒绝旧 world，不静默 prepare。
10. verifier 先留在所属 E2E 仓库。
   至少两个自治仓库出现相同稳定需求后，才评审公共包。

## 渲染边界裁决

现有 unit 与 E2E 文档对渲染所有权有冲突，本决策采用下面的边界：

| 证明对象 | 所有者 |
|---|---|
| 排序、聚合、单位、覆盖、树投影等无媒介数据语义 | unit 机制证明或 unit 行为主证明 |
| CLI argv、退出码与信号 | process-result 读面 |
| `exp --json` 生命周期事件 | NDJSON event stream，逐行按事件身份解析 |
| plain stdout 的公开文字与结构语义 | 真实 CLI 读面 |
| PTY 的宽度、折行、降级与 CJK 显示宽度 | 显式 PTY E2E |
| JSON / JUnit 的字段、身份与结果语义 | 真实机器出口，parse 后比较 |
| HTML 的可访问语义 | Playwright + 真实 Chromium 读取导出 HTML |
| 浏览器交互、CSS 布局与可见状态 | Playwright 浏览器 E2E |

同一个产品行为只选一个主证明。
text / web parity 这类关系行为由同一个主证明观察两面并比较，不拆成两个互不相干的通过项。
其它媒介测试只证明该媒介独有的接线和降级，不复制完整语义矩阵。

## 迁移顺序

1. 先在 Runner 缓存与 Report 读面各选三到五个高风险行为，建立 Behavior ID、主证明和失败格式。
2. 为这两个域实现局部 typed view。
   不建立全仓基类，也不发布公共 verifier。
3. 把 Report E2E 改成命名且不可变的 evidence worlds，再接入 Vitest 聚合与单例重跑。
4. Registry 能覆盖试点用户行为后，只移除被它取代的用户行为 bullet。
   Unit 测试文档只允许“观察缝”“错误算法”“Fixture 区分力”“风险理由”四个字段，不能换个标题继续复述产品结果。
   规范性结果只链接 Feature / architecture 条款，不在 testing 文档重写。
   场景目录由 Registry 在 CI 生成且不签入。
5. 分别记录公开契约变更、内部重构、失败定位时间和误报跟改。
   试点证明收益后再扩到其它 Feature。

迁移后的 Unit 测试文档条目固定为：

```markdown
## <风险主题，不写产品结果>

- 契约：<Feature / architecture 链接>
- 观察缝：<为何从这里观察>
- 错误算法：<删除 proof 会放走什么错误实现>
- Fixture 区分力：<怎样区分正确与错误实现>
- 风险理由：<为何需要 primary / boundary / supporting proof>
- Proof：<稳定 ID 列表>
```

它不包含逐场景期望、测试标题镜像或手写覆盖目录。

Runner 的 Effect 机制测试可以在第二步同时试点 `@effect/vitest`、`it.effect`、`TestClock` 与 Layer。
这项迁移独立验收，不作为行为作者面上线的阻塞条件。

## 契约落点

试点通过后，把选中的规则写回正式工程契约：

- [测试体系总纲](../../engineering/testing/README.md)：补上行为 / 机制作者轴和新的渲染所有权。
- [Unit 总纲](../../engineering/testing/unit/README.md)：把六类证明改成 proof tags，并加入 `test/unit/behavior/`。
- [Registry](../../engineering/testing/unit/registry.md)：从文件级 `// cases:` 改成 Behavior、主证明与可选 supporting proof。
- [Harness](../../engineering/testing/unit/harness.md)：定义 Feature-owned User View 的边界，并允许复杂机械 harness 自测。
- [E2E 总纲](../../engineering/testing/e2e/README.md)：定义 frozen evidence world、单例重跑与自治 adapter。
- [Report E2E](../../engineering/testing/e2e/report.md)：按 plain stdout、PTY、JSON、HTML 与 browser 重画观察面。
- [E2E Acceptance DSL](../../roadmap/e2e-acceptance-dsl/README.md)：收敛为 Report typed view 的内部 adapter 设计。

机器守护落到 `test/docs/`，继续由 `pnpm test:docs` 执行。
试点未通过前，不批量删除现有覆盖文档或迁移机制测试。

## 复审触发条件

只有同时满足下面条件，才重新考虑 PLAN-3：

- 至少两个独立用户读面重复表达同一组稳定 Action 与 Outcome。
- typed view 的重复无法通过小型能力接口消除。
- 投影后的失败仍能指出具体 driver、对象身份与原始观察。
- 声明不需要根据 unit / E2E 或媒介类型写条件分支。
