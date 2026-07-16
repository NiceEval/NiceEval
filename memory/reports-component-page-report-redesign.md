# 设计裁决:Reports 组件/页/报告三层重设计(resolve 管线、content 字段、Scope 改名)

**日期**:2026-07-16

**裁决**(现行契约见 `docs/feature/reports/`,本条只记翻案过程):

1. **组件自带解析面(spec 形态)**,管线 `装载 → resolve → validate → render`;组件分双面/组合两种,`defineComponent` 函数/对象双形态。
2. **`defineReport` 单一产物**(外壳 + 非空页列表),页字段 `content`,页是字面量不设 `definePage`。
3. **内建报告塌缩成一行** `export default defineReport(<ExperimentComparison />)`,`comparisonReport` 具名导出取消。
4. **`Selection` 改名 `Scope`**(全 docs 已替换)。
5. **`ctx.report`**:组合组件可读规范化报告声明(title 回退后值/links/footer/页列表/当前页 id);scripts/styles 不进。
6. **导出无档位**:`view --out` 是复印机,根里存在且前端会读取的证据文件(含 diff.json)全部复制、o11y.json 永不复制;体积取舍单点在 `copySnapshots({ artifacts })`,保密单点在 `redact` 落盘标记;「数据等级」措辞改「发布防呆」(二元,非档位)。曾选「导出层给 minimal/standard/full 档位」否决——两个真实关切(泄密/体积)正交且各有单点的家,档位杆是第三个记不住内容物的旋钮;旧契约「diff.json 一律不随站复制」也否决——那是隐藏档位,证据完整性按「根里有什么带什么」如实。
7. **术语「消毒」→「脱敏」**(数据工程标准词;API 面 `redact`/`publish.redaction` 不动;展示层继续叫「遮蔽」);「数据等级」→「发布防呆」(二元非档位)。
8. **按实验收窄发布 = 换根**:`copySnapshots(scope.filter(...))` 构建只含该实验的发布根;`view --out` 与位置参数/`--experiment` 互斥。曾选「--out 支持收窄参数」否决——报告槽收窄不动证据室,发布者会误以为站点只含该实验而实际全部证据出站(泄漏惊讶);报告级聚焦在报告文件里用组件 `input` 表达。

**曾选方案与否决理由**:

- **手工两步式**(`const data = await xData(scope); <X data={data}/>` 作为唯一写法):HEAD cb21157 之后工作树曾把 docs 全面改回这个形态(删掉 resolveReportTree 阶段的描述)。否决:视图描述(points/x/y)离视图最远、配对靠命名约定、并行靠用户写 `Promise.all`;是 RSC 惯性不是理想形态。data 形态保留为显式降级口(JS 加工/JSON 导出/嵌入)。
- **`ReportBodyDefinition` / `ReportSiteDefinition` 双产物 + `ReportBuild`**:否决——同名函数返回可嵌入/不可嵌入两种值,读 import 无法判断编译能否通过;`(ctx) => 树` 的 build 函数是「既像组件又像页内容」的隐藏第四概念。build 函数职责由组合组件接住,页内复用改走具名导出。
- **`definePage`**:否决——页没有需要定义时强制的契约,空 define 制造神秘感与新的嵌套问题。
- **「外壳不进组件 ctx」**(本轮早先自己的裁决):同日翻案为 `ctx.report` 只读暴露。翻案理由:判据「ctx 只携带宿主才知道的东西」实际支持暴露*规范化后*的声明(回退链后的 title 是宿主算的);无特权原则要求宿主 chrome 消费的声明组件也能读。仍只进组合组件,resolve/渲染面不给(数据可序列化、两面同源)。
- **自定义 config 袋**(`defineReport({ config: {...} })` 经 ctx 消费):否决——宿主不消费的值不属于声明;模块导入 + 装配处 props 是全类型通道;报告树仅两三层,无 React Context 要解决的深透传;类型安全版需要第四个 definer(context handle),复杂度回流。
- **组合组件第二入参 ctx 曾考虑 props 注入**(`input`/`results` 作保留 prop):否决——保留字段污染 props 命名空间;TSX 对 `(props, ctx) => ...` 的 JSX 检查经 `defineComponent` 包装解决,ctx 走第二入参。
- **`Scope` 的备选名**:`ResultSet`(与 `Results` 读取面撞脸)、`View`(撞 `niceeval view`)、`Slice`;取 Scope 因中文契约通篇已用「范围收窄」。

**落点**:docs/feature/reports/ 全组 + docs/feature/results/library.md(Scope)+ docs/concepts.md + unit-tests/reports/cases.md,同批重写于 2026-07-16;src 实现见 plan/reports-redesign-implementation.md。
