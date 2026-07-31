# 报告下钻翻案:实体特权页收敛为中立参数化页 + ReportTarget

- **裁决**(2026-07-31):报告 page 只有一种形状 `PageDefinition{id,title,navigation,params?,load?,render}`。`params{encode,decode,enumerate}` 声明参数化页,`load` 声明输入来源;下钻统一为 `ReportTarget{page,params}` 经宿主唯一通道 `ctx.href(target)` 换 URL,换不出返回 undefined 转纯文本。全库唯一默认规则 `targetOfRefs()`:refs 恰好一个才给 attempt 目标,多 refs 不猜。view 路由收敛为 `#/<pageId>` 与 `#/<pageId>/<key>`,静态导出按各参数化页 `enumerate(有效根)` 物化 `<pageId>/<key>.html`。新增 `standardExperimentPage` + `ExperimentDetails`(load 就是 `sample.scope({experiments})`),`ExperimentScatter` 点目标默认指向它。
- **曾选方案与否决理由**:
  - `input: "sample" | "attempt"` 封闭枚举 + `ctx.attemptHref`(原契约):core 认识实体词,每加一种详情(experiment、eval、分组)都要在目标类型、路由、dialog、导出各开一支分支,并炸穿穷尽 switch;chart 无条件取 `refs[0]` 导致实验散点点开是「碰巧排第一的 attempt」——多证据压成一个链接必然指错。
  - 判别联合 `ReportTarget = {kind:"attempt"} | {kind:"page",scope}`(中间稿):attempt 仍单开一支,特权只是换了位置;被「attempt 也只是一张 load 读证据的页」推翻。
  - 给 `SamplePageContext` 加可选 `scope` 字段(中间稿):正撞 optional-field-additions-need-call-site-census 的坑;`load` 显式必选,面消失。
- **触发现象**:实验散点点开 `#/attempt/@1kp8gz7h`,是该实验 refs 并集的第一个 attempt,与点的语义(实验)无关。
- **外部对照**:TanStack Charts 的交互契约「chart fires callbacks, the application decides semantics」是原语中立的判据;niceeval 数据绑定层(字段访问器、EvidenceRow 普通值)本已同构,失衡只在交互层。
- **落点**:docs/feature/reports/{library,architecture,view}.md、components/{README,charts/README,experiment-detail/README,summaries/experiment-scatter,attempt-detail/README}.md、library/{built-in,shell}.md、show.md、show/reports.md、use-case 四页、concepts.md 立词、engineering/testing/unit/reports.md 覆盖声明、docs-site/zh 两页。代码未动,实现按新契约跟上。
