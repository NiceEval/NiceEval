# Reports 第七批：宿主内容特权全部清零（证据页 / hero / 警告 / 品牌组件化）

**日期**：2026-07-17。**触发**：用户 review 内建报告与 view 页面时质疑「报告 / Attempts / 追踪都应该是定义出来的页；hero 与警告区应该是组件；docs 设计应尽可能通用、不给官方特异」，指着 DevTools 里的 `.report-slot > .nre > .nre-warnings` 问它算不算组件（不算——是宿主烘进报告槽的前置块）。诊断出的根因：现契约违反了 built-in.md 自己的验收标准「内建自己必须写得顺」——裸 view 页面上宿主开小灶的部分（证据页、hero、警告块、品牌位、CopyFixPrompt）内建那份「报告文件」写不出来，说明 API 缺件，shell.md 的「特权只剩渲染位置」正是这个缺口的补丁。

## 裁决

宿主没有内容特权，只保留机器（管线与路由、attempt 详情路由、文档单例、语言切换，穷尽清单在 `docs/feature/reports/architecture.md#宿主保留的只有机器`）。落成七条（PLAN 第七批 44–51，docs 2026-07-17 已全部改写）：

1. 内建报告 = 三页普通 defineReport（report / attempts / traces），Attempts 页 = `<AttemptList filter />`，Traces 页 = 新 `TraceWaterfall`；导航只有报告页，宿主不追加项。
2. hero = `Hero`（组合组件，缺省读 `ctx.report.title`）+ `HeroCard`（双面，data 唯一）。
3. 警告 = `ScopeWarnings` 双面组件，宿主树外警告通道删除；skipped-snapshot 并进新 warning kind `unreadable-snapshot`。警告可见性成为作者义务（与增强脚本同一信任模型）。
4. 品牌 = `PoweredBy` 组件：**提供一个组件、不给配置**，用户不爽自己重写组件（用户原话裁决）；宿主页头字标与 `utm_medium=brand` 链接删除。
5. show 多页从「只出索引」改为「渲染初始页 + 尾部其余页索引」——否则内建变三页后裸 show 的默认榜单要多一跳，agent 循环 UX 回退。
6. 深链不变量换保证方式：不再靠「证据页恒在 + 证据室不收窄」，改靠「attempt 详情路由对完整结果根解析、不占导航」；页（含内建 Attempts 页）一律共享收窄后的 Scope，契约分叉消失。

## 曾选方案与否决理由

- **证据页归宿主、恒随导航**（第二轮维持、architecture.md 曾整节论证）：否决。三条论据逐一失效——深链恒在由详情路由保证；Traces 的 text 面可以定义（locator 索引 + `--timing` 命令，符合「索引终结于可执行命令」）；「不交给作者配置」与 beta 无特权原则冲突。
- **品牌位恒在、报告定义不可移除**（第四批当场推翻 poweredBy 开关、第六批加页头字标，均为用户裁决）：本批被同一用户再翻案。演进线：恒在且无开关 → 恒在 + 页头字标 → 组件化无开关。不变的部分：**组件本身永远不给关闭配置**。
- **宿主统一渲染警告、报告放不放不影响可见性**：否决。理由对齐已有先例——对自定义脚本已裁「不变量是作者义务」，对警告没理由更严。

## 教训

built-in.md 的「内建写不出来说明 API 缺东西」是个可执行的架构探针：任何宿主 chrome 只要内建报告文件表达不了，就该怀疑是不是该组件化，而不是给 ctx 或契约加「特权只剩……」式的例外条款。
