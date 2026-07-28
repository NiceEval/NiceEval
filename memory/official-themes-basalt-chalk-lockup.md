# 官方主题定为两套单支锁定:basalt(暗·直角)与 chalk(浅·圆角)

**裁决**(2026-07-28,用户在对话中定):官方主题提供两套、各锁一个外观分支——
`basalt` = `appearance:"dark"`,色板与 `docs/SVG-DESIGN.md` / view 既有暗色令牌**同一份**
(#050505/#0b0b0b/#262626/#ededed 族),`radius:"0"`;`chalk` = `appearance:"light"`,
圆角 8px、蓝 accent,用「处处相反」证明观感完整住在主题令牌里。官方 stylesheet 零写死:
每个用点 `var(--niceeval-*, <basalt 兜底>)`,兜底与 `src/report/theme.ts` 逐项相等由
`test/unit/report-theme-tokens.test.ts` 守护(盖住 report 与 view 两份 CSS),
basalt 因此不需要自带 `styles`。

**曾选方案**:basalt.md 初稿是一套 `appearance:"system"` 双分支主题,自立色板
(#0A0B0C/#101214/#26323A 族,与产品既有暗色令牌不同源),并靠自带 `styles`
(box-shadow:none、uppercase 小标签、focus 环)补官方样式表达不了的主张。

**否决理由**:①双分支自立色板让产品出现第四份色板(view :root、report styles.css、
colors.ts 之外又一份),SVG-DESIGN 的图示色与产品观感从此两套;②默认主题带 `styles`
意味着「不装主题」与「装 basalt」不同观感,兜底等式不成立;③浅色诉求由独立主题承担,
比一套主题里养两支更能证明主题机制可换。

**同批落地**(实现细节,防复跑):`.nre`/`nre-*` 全量让步 docs 契约改
`.niceeval-report`/`niceeval-*`(用户确认);199 个孤儿类死 CSS 删净、
`test/unit/report-css-orphans.json` 清零;色板副本三杀(colors.ts 改从 basalt 派生并改名
`SERIES_PALETTE`,view :root 与 report 兜底读令牌);`themeStylesheet` 除 `:root` 外补发
`.niceeval-report{color-scheme}`,否则锁定外观时报告内 `light-dark()`(tok-* 语法高亮)
仍按 OS 选支;`NRE_PALETTE` 导出名一并消失(公开面破坏性变更,beta 允许)。
总纲入口在根目录 `DESIGN.md`。
