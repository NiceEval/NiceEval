# 报告主题:可分发的外观制品 + 官方主题 Basalt:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 主题制品、四档装载链、`ReportTheme` 字段穷尽、校验分类、级联顺序、`themeStylesheet`:`docs/feature/reports/library/theme.md`
- 官方主题取值与视觉主张(黑色系 / 零圆角 / 发丝分隔 / 验收要求):`docs/feature/reports/themes/basalt.md`,目录 `docs/feature/reports/themes/README.md`
- 外壳字段位置(`theme` 收 `ThemeDefinition`、新增 `seriesPins`、`styles` 的加载次序):`docs/feature/reports/library/shell.md#字段穷尽`、`#钉色`
- 装载管线与「主题只产出令牌、色分配只产出下标」:`docs/feature/reports/architecture.md#主题装载与报告并列的第二条链`
- 内建主题名表 = `niceeval/report/built-in` 具名导出:`docs/feature/reports/library/built-in.md#内建主题`
- CLI 侧:`docs/feature/reports/view.md#主题`、`docs/feature/reports/show/reports.md`(`show --theme` 报错)
- 用例全流程:`docs/feature/reports/use-case/theme-and-distribute.md`、`docs/feature/reports/use-case/write-custom-component.md`
- 测试覆盖类别:`docs/engineering/testing/unit/reports.md`「主题装载与规范化」「`seriesPins` 在页级色分配中的作用」
- 用户文档:`docs-site/zh/tutorials/theming.mdx`、`docs-site/zh/tutorials/custom-reports.mdx`

## 前置:令牌面归一(这一步不做,后面全部落空)

今天 `src/report/assets/styles.css` 与 `src/view/styles.css` 说的不是 docs 里那套词:系列色是 `--nre-c0..c5`,中性面直接用了 view 的无前缀变量(`--muted` / `--line` / `--panel` / `--panel-2` / `--blue`)。主题要生效,消费点必须先统一到公开令牌名。

- [ ] **P1.** 全量替换 `src/report/assets/styles.css`(约 2000 行)的令牌消费点:`--nre-c0..c5` → `--nre-series-1..6`;`--muted` / `--line` / `--panel` / `--panel-2` / `--blue` 等 → `--nre-text-muted` / `--nre-border` / `--nre-surface` / `--nre-surface-subtle` / `--nre-accent`。逐处判定语义,不做机械替换——`--muted` 在不同规则里可能分别对应 `text-muted` 与 `text-soft`。
- [ ] **P2.** 每个使用点写成 `var(--nre-*, <Basalt 的值>)`:嵌进用户页面、不声明任何令牌时看到的必须就是 Basalt(docs 明确要求两条交付路径同一个样子)。不在 `.nre` 上重新声明一套变量——那会遮住宿主主题。
- [ ] **P3.** `src/view/styles.css` 的 chrome 改读同一组 `--nre-*`,不再各自持有一份色板。
- [ ] **P4.** `src/report/assets/colors.ts` 的六色表改为 Basalt 的两支取值,并确认它只服务 `SeriesColor.hex`(不经 CSS 的消费方),不再是 CSS 的事实来源。
- [ ] **P5.** 改完跑 `pnpm run build:report`(dist 预编译)再 typecheck——改 `src/report/**` 不重编,link 消费项目看不到变化(见 memory `linked-consumer-stale-dist-report`)。

## TODO

- [ ] **A. 类型与 `defineTheme`**(新文件 `src/report/definition/theme.ts`)
  - [ ] A1. `ReportTheme` / `ThemeColor` / `ThemeColorPair` / `ThemeSeries` / `ThemeDefinition` 按 docs 形状定义,`ReportAsset` 复用外壳那一个。TSDoc 按 docs 定稿写(参考页文案单源在这里)。
  - [ ] A2. `defineTheme` 的运行期校验分两类:颜色走 `/^#[0-9a-f]{6}$/i`;`font` / `fontSize` / `radius` 收非空字符串但拒 `;` 与 `}`(报错指引改用 `styles`)。错误一律指到字段路径(`theme.series[3].dark`)。
  - [ ] A3. `themeStylesheet(theme)` 从 `niceeval/report` 顶层导出:规范化 → 令牌块字符串。它与 view 注入用的是同一个规范化函数,不写第二份。
- [ ] **B. 外壳字段**(`src/report/definition/report.ts`)
  - [ ] B1. `ReportShell.theme` 的类型从内联对象改成 `ThemeDefinition`;`extends` 折叠时整字段覆盖(已有语义,确认新类型不破)。
  - [ ] B2. 新增 `ReportShell.seriesPins`,装载期校验维度名 / 值键非空、下标是 `[0,6)` 整数,报错指到 `seriesPins.<维度>.<值>`。
  - [ ] B3. **调用点普查**:`seriesPins` 从主题移到外壳是搬家不是新增,grep **旧**位置(`theme.seriesPins`)的全部消费点逐个改判,别让「两处都读」的回落分支留下来(规则见 CLAUDE.md「给共享接口加可选字段」)。
- [ ] **C. 装载链**(`src/report/runtime/load.ts` + `host.ts`)
  - [ ] C1. `--theme` 值形态判别复用 `--report` 那一个纯函数(判别只看字符串、不探测文件系统),内建主题名表取自 `niceeval/report/built-in` 具名导出,不另立常量表。
  - [ ] C2. 四档归一:`--theme` → 报告外壳 `theme` → `config.theme` → 内建 `basalt`,产出一个 `ThemeDefinition`。**不跨档合并**——未声明的令牌取 Basalt 值,不取下一档同名令牌。这一条是最容易实现成「深合并」的地方,写的时候对着 C 类单测。
  - [ ] C3. `config.theme` 加进 `Config` 类型与校验,非 `defineTheme` 产物时报错点名配置文件的 `theme` 字段。
  - [ ] C4. mtime cache-busting 的入口按实际装载的那个文件走,与 `--report` 同规则。
- [ ] **D. 规范化与站点管线**(`src/view/`)
  - [ ] D1. 规范化:单值展开成相同 light / dark,pair 保留两支,未声明取 Basalt;产出完整令牌表 + 有序资产清单。纯函数,不 IO。
  - [ ] D2. 令牌块挂文档根;主题 `styles` 在官方样式之后、外壳 `styles` 之前注入(级联六层,顺序见 docs)。
  - [ ] D3. 主题资产走既有内容哈希物化(`assets/<sha256><ext>`),**路径基准是主题文件**,不是报告文件。路径纪律(拒 `..` / 绝对路径 / `~`)与外壳同一份实现。
  - [ ] D4. 装载或资产解析失败 → view 启动 / `--out` 整体失败,不带半份主题继续。
- [ ] **E. 外观切换**
  - [ ] E1. `appearance` 落成文档根 `color-scheme`;`light` / `dark` 锁定分支且**不渲染**切换控件,`system` 才渲染。
  - [ ] E2. 切换控件进 `src/report/assets/enhance.js` 同一增强层:按站点作用域存 localStorage,不改任何数值;关掉 JS 时初始 HTML 就是声明的那一支。
- [ ] **F. 页级色分配**
  - [ ] F1. 分配算法改读外壳 `seriesPins`(原读主题),输出仍只是下标;确认换 `series` 色板不触发任何重算——这是 F 类单测唯一会红的那一格。
- [ ] **G. 内建主题 Basalt**(`src/report/built-in/basalt.ts`)
  - [ ] G1. 按 `themes/basalt.md` 的三张表落令牌,`radius: "0"`、`fontSize: "13px"`,`styles` 落设计页里那段(去阴影 / 标签小字距 / tabular numerals / 下划线链接 / 1px focus)。
  - [ ] G2. `index.tsx` 具名导出 `basalt`;它与 `standard` 互不耦合(`standard` 不声明 `theme`)。
  - [ ] G3. Basalt 的值与 P2 的 `var()` 兜底值必须同源:从 `basalt.ts` 生成或有守护,不手抄两份。
- [ ] **H. 文案与 i18n**
  - [ ] H1. 新错误 key 进 `src/i18n/` 两份词典:裸词未命中内建主题名表、`config.theme` 非 `defineTheme` 产物、`show --theme`、主题资产路径违规、颜色 / CSS 值校验。
  - [ ] H2. `src/cli.ts` `FLAG_OPTIONS` 新增 `theme` 项并写 JSDoc(缺注释生成器报错)→ 跑 `pnpm docs:reference`;核对 `src/i18n/` 两份 `--help` 速查。
- [ ] **I. 单测**:按 `docs/engineering/testing/unit/reports.md` 新增的两个类别写。区分力要求已写在那里,重点两条:四档用互不相同的令牌值构造并至少配两档以上;换色板不改下标。
- [ ] **J. 真实项目冒烟**(在 `/Users/ctrdh/Code/MemoryBench` 跑,核对输出与 docs 预期一致)
  - [ ] J1. 裸 `view` 是 Basalt:黑底、直角、发丝线;浅色分支切一次。
  - [ ] J2. `--theme ./themes/acme.ts` 换一份自写主题;`--theme basalt` 回官方;`--theme typo` 报错列名字。
  - [ ] J3. `config.theme` + 报告外壳 `theme` 同时在场时生效的是外壳那份;再加 `--theme` 时生效的是 flag 那份。
  - [ ] J4. `--out site` 后直接双击打开 `index.html`,关掉 JS 仍完整可读、外观正确。
  - [ ] J5. `show --theme` 报错文案与 `show/reports.md` 一致。
- [ ] **K. 同步义务**
  - [ ] K1. `docs/source-map.md` 补主题装载、规范化、Basalt、令牌面归一的落点行。
  - [ ] K2. 英文 docs-site 入口按中文与最终代码核对后同步(`tutorials/theming.mdx` 英文页 + `docs.json` 英文导航项,当前只加了中文);`docs:validate` + `docs:links`(Node 22)。
  - [ ] K3. `pnpm test` + `pnpm run typecheck` + `pnpm run build:report`。
  - [ ] K4. Basalt 的验收清单(对比度、四态、六 series 三种色觉模拟 + 灰度、focus 环)是官方主题的交付条件,不是可选项;做不到就改取值,不是改契约。
