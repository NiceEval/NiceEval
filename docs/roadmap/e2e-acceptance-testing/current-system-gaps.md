# 现行测试体系为什么仍会漏掉完整产品回归

本篇对照当前 [`docs/engineering/testing/`](../../engineering/testing/README.md) 与实际 `e2e/report`，解释为什么已经有大量测试、每个逃逸 bug 也会补回归文件，仍然需要靠用户在真实 Report 中发现“链接存在但 modal 打不开”。

## 结论

问题不是“没有 E2E”或“断言数量不够”，而是四个闭包没有同时成立：

1. **覆盖闭包**：Feature 抽象升级后，proof 仍覆盖新的完整抽象，而不是旧实例。
2. **执行闭包**：相关 proof 在产生改动的同一候选上、反馈仍有用的时间点实际运行。
3. **证据闭包**：producer、导出产物、hosting、浏览器 consumer 属于同一个冻结 world。
4. **失败闭包**：一处失败能落在最早阶段，并且不遮住同批其它 Behavior。

现行体系分别拥有这些能力的局部实现，但没有把四个闭包变成一个可执行门禁。

## 本次 modal 逃逸的具体链条

Report Feature 已把详情机制定义成通用参数化页：内建至少有 `attempt` 与 `experiment`，宿主按最终 pageId 清单拦截 `<pageId>/<key>.html`，不认识实体种类；dialog 还承担直接 deep link、关闭、焦点、滚动与嵌套下钻。
见 [View · 参数化页 dialog](../../feature/reports/view.md#参数化页的-dialog-摆放)。

现有单元测试也已经验证 `planSite` 对 attempt 与 experiment 两类页面生成文件，说明数据 / 规划层知道新抽象。
但是浏览器 E2E 仍把路径写死为 `attempt/<locator>.html`，组件场景也只以 locator 和 AttemptDetails 命名：

- [`src/view/site-param-pages.test.ts`](../../../src/view/site-param-pages.test.ts) 证明计划层的通用文件集合；
- [`e2e/report/scripts/verify-render-visual.ts`](../../../e2e/report/scripts/verify-render-visual.ts) 只点击一个 attempt locator；
- [`e2e/report/scripts/report-components/attempt-detail.scenarios.ts`](../../../e2e/report/scripts/report-components/attempt-detail.scenarios.ts) 只覆盖 attempt 详情。

因此“通用 producer 已迁移、浏览器 consumer 仍按旧实例验收”的组合可以同时满足：

- unit 绿：`enumerate()` 与计划文件集合正确；
- 旧 attempt E2E 绿：某个代表 attempt 仍能打开；
- 新产品坏：experiment、自定义参数化页或某条新的导出接线路径没有生成对应静态文档，用户点击后 404。

截图中的具体症状更早：链接已经存在，但对应 attempt 文档没有产出。现有 attempt E2E 若在同一候选上完整执行本应变红；它最终靠人工发现，说明除了覆盖抽象，还存在执行反馈的问题。

## 现行规则的七个失效机制

### 1. “所有 E2E 都必须真实模型”把确定性产品闭环也变昂贵

[测试总纲](../../engineering/testing/README.md#分层谁负责证明什么)把 E2E 统一定义为真实 provider 凭据，
[E2E 总则](../../engineering/testing/e2e/README.md#7-验收域)进一步规定功能仓库同样必须使用真实 Agent / 模型、全部 E2E 都需要凭据。

这个规则对 adapter 协议正确，但对 `view --out → HTTP → Chromium → dialog` 不成立：这条 proof 的外部世界是 Node 子进程、文件系统、HTTP 和浏览器，不是模型。强行把它绑定到真实模型会产生三个后果：

- 本机没有 secret 时不能运行，失去秒级 / 分钟级反馈；
- 一个纯 UI 重构也必须等待整仓 evidence producer；
- provider 故障会在浏览器 Behavior 之前 fail-fast，真正需要验证的路径根本没执行。

新方案不是增加“mock E2E”，而是允许**真实公开入口的确定性 E2E**：用 deliberate Experiment 经真实 CLI 产生最小 Record，再走真实候选包、静态导出、HTTP 与 Chromium。没有伪造待测边界。

### 2. unit 禁止渲染是对的，但中间没有便宜的公开组合 proof

总纲正确地禁止 unit 锁 HTML / DOM；Reports 单元测试负责数据、装载和站点计划。
问题是另一端只有整仓、带模型的 Report E2E。两个端点之间缺少可独立选择的 `report-target-closure`。

于是开发者有两个现实选择：只跑快速 unit，或运行整个 Report E2E；当后者成本、凭据或反馈时间不合适时，跨层接缝只能等 CI 或人工发现。

### 3. “改了什么，跑什么”只是操作卡，不是可执行影响图

[测试总纲的操作卡](../../engineering/testing/README.md#操作卡改了什么跑什么)要求 `src/report` / `src/view` 改动追加 `pnpm e2e --repo report`，但仓库没有把 Feature coverage category、源码影响面和 E2E Behavior 建成机器可核对的关系。

它能指导一个已经知道该跑什么的人，不能阻止：

- 本地提交未运行对应 E2E；
- Feature 从 attempt 升级为 target，旧 Behavior 仍被当作覆盖存在；
- 一个总命令存在，但其中相关场景因更早失败从未到达。

### 4. 覆盖登记只防“整册脱钩”，不防类别漂移，也不登记 E2E

[覆盖登记](../../engineering/testing/unit/registry.md)明确说机器守护只保证 src 测试文件与测试文档不整册脱钩，类别级对应依赖人工评审。
它也以 `src/**/*.test.ts(x)` 为主，不要求 E2E Behavior 声明自己覆盖哪个 Feature category。

所以“Reports 有测试文档”“E2E 有 attempt dialog 场景”都可以为真，但没人机器核对“参数化 target 闭环”这个新类别是否有浏览器 proof。

新方案不再发明一套 coverage manifest，而是让**高风险跨层类别**绑定已经选定的
[PLAN-2 Behavior](../../design/user-readable-testing/PLAN-2/README.md#behavior)：

```ts
reportBehavior({
  id: "reports.target-closure",
  task: { repository: "niceeval", path: "docs/feature/reports/use-case/…", anchor: "…" },
  contract: { repository: "niceeval", path: "docs/feature/reports/view.md", anchor: "参数化页的-dialog-摆放" },
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["html", "browser-a11y"],
      boundaries: ["installed-package", "real-cli", "real-browser"],
    },
    execution: { mode: "read-only", evidenceRecipeId: "report-targets-v1" },
  },
});
```

守护核对 coverage category ↔ 主 Behavior ↔ E2E 执行登记的双向关系；具体实例仍由测试代码枚举。

### 5. Report 验收说明是一张巨大清单，抽象升级后旧名仍看起来合理

[Report E2E 计划](../../engineering/testing/e2e/report.md)覆盖很多公开行为，但导出、视觉和自定义报告段落仍主要围绕 `attempt/<locator>.html`、attempt-input page 与 locator 深链书写。
一条新 Feature 把宿主升级成通用参数化页时，文档中没有一个独立、可替换的“target closure”类别要求同步升级。

结果不是完全没有测试，而是测试仍然证明旧命题：**attempt 能打开**；产品的新命题已经是：**最终清单里的任意参数化页都由同一宿主机制打开**。

### 6. 线性 fail-fast 既不能单例重跑，也会遮住后续失败

[验收脚本写法](../../engineering/testing/e2e/verification.md)规定不用测试框架、单线流程、第一处失败即抛错。
实际 Report runner 还依赖手工顺序，因为后置 verifier 会改写共享 resultsRoot。

这使“补了一个测试文件”仍不等于它每次得到执行：前面的 provider、格式或读回断言红了，浏览器场景没有结论；修一个场景时又必须重跑完整 producer 和此前所有 verifier。

冻结 world、vitest Behavior、按 id 单例重跑和失败聚合解决的是运行学，不是语法糖。

### 7. 跟改率只能发现脆弱测试，发现不了“稳定但过时”的测试

[测试跟改率](../../engineering/testing/churn.md)统计源码变更时哪些测试文件总跟着改，适合发现锁实现细节的脆弱测试。
但一个 attempt 专用 E2E 在 target 重构后完全没改，跟改率反而很好看；它只是已经不再覆盖产品抽象。

因此 churn 继续保留为维护性指标，但不能充当覆盖完整性指标。覆盖完整性必须由 category ↔ Behavior 登记、结构 census 和真实旧 bug kill test 提供。

## 为什么继续补 bug 回归文件仍不够

逃逸 bug 的处理若停在“为这一个 404 加一条 attempt test”，只能锁住一个实例。下一次同形缺陷换成 experiment、custom page、nested target 或 clean-url hosting，仍然会逃逸。

修复流程必须多一步 **escape audit**：

1. 写出用户可见的错误事实，不先写根因；
2. 判断现有 coverage category 是否本来就应该捕获；
3. 若是，修复或替换失效 proof，而不是并排再加一份；
4. 若不是，把类别提升到能吸收同形反证的抽象，例如 `attempt dialog` → `parameterized target closure`；
5. 在 fix parent 或最小逆补丁上运行，证明新 proof 真能杀死旧 bug；
6. 用同形反证验证它不是 bug 专用 matcher。

测试数量可以不增加，覆盖命题必须升级。

## 对现行 testing 文档的采用改动

本 Roadmap 定稿时，需要同步改写而不是旁挂以下当前契约：

| 当前文档 | 需要改变 |
|---|---|
| `engineering/testing/README.md` | 两层不变；E2E 运行依赖拆成 deterministic / external / lifecycle 三档，不再声称全部需要 provider |
| `engineering/testing/e2e/README.md` | `secrets` 变成 recipe 能力而非 E2E 身份；唯一命令支持 `--behavior`；仓库可先 prepare 再单例 verify |
| `engineering/testing/e2e/report.md` | 用通用 target closure 替代 attempt 专用导出 / modal 条目；确定性浏览器档成为 PR 硬门禁 |
| `engineering/testing/e2e/verification.md` | 线性 `node:assert` 参考改成 Behavior + 冻结 world + 失败聚合；仍保留真实 shell 原文和公开入口 |
| `engineering/testing/unit/registry.md` | 为高风险跨层 category 增加稳定 id 与 E2E Behavior 双向登记；不枚举具体 scenario |
| `engineering/testing/churn.md` | 明确它只量维护性，不量 coverage freshness；周期审计同时查看无跟改但契约已升级的 proof |

在这些当前文档尚未迁移前，新的 DSL 与测试方案都只是候选设计，不能宣称已经防住同类回归。
