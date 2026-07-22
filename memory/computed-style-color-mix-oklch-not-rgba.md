---
name: computed-style-color-mix-oklch-not-rgba
description: 报告 CSS 大量用 color-mix(in oklch, ...) 做浅染背景,Chromium 里 getComputedStyle 算出来是 oklch(L C H / A) 斜杠语法,不是 rgba(r, g, b, a)——按传统 rgba 正则解析 alpha 会直接失配
metadata:
  node_type: memory
  type: project
---

**现象**：给 `e2e/report/scripts/verify-render-visual.ts` 写「状态染色是浅色透明混合、不是
饱和色块」的断言时，用 Playwright `locator.evaluate(el => getComputedStyle(el).backgroundColor)`
读到形如 `"oklch(0.575258 0.162549 255.538 / 0.08)"` 的字符串，用传统
`/rgba?\(...,...,...,(?:,([\d.]+))?\)/` 正则去解析 alpha 分量直接匹配失败、抛
`AssertionError`。

**根因**：`src/report/assets/styles.css` 里状态行浅染背景全都是
`background-color: color-mix(in oklch, var(--bad), transparent 92%)` 这类写法（源码注释
自己写了"与示例卡 prism vsDark 主题同源"的设计意图，用 oklch 是为了色彩混合更符合感知均匀）。
Chromium 对 `color-mix()` 的 computed style 序列化不会折算回 `rgb()/rgba()`，而是直接吐出
参与混合的色彩空间语法本身（`oklch(L C H / A)`，斜杠分隔的第四项才是 alpha），css 里没有
`color-mix()` 的普通颜色属性才会是经典 `rgb()`/`rgba(r, g, b, a)` 逗号语法。

**修法**：alpha 解析函数两种语法都要认——先按 `/\s*([\d.]+)\s*\)\s*$/` 找末尾斜杠后的数字
（覆盖 `oklch()`/`oklab()`/`lch()`/`lab()`/带斜杠的 `rgb()` 等所有现代 CSS Color 4 语法），
找不到再退回经典 4 参数 `rgba(r, g, b, a)` 正则；两者都没有就视为完全不透明（纯 `rgb()`
三参数）。落点：`e2e/report/scripts/verify-render-visual.ts` 的 `colorAlpha()`。

**适用场景**：任何用真实浏览器（Playwright/Puppeteer）对本仓库报告 CSS 做 computed-style
断言、且断言涉及颜色透明度（`color-mix()`/浅染/tone 底色）的场景——不要预设
`getComputedStyle` 的颜色输出格式，先在真实浏览器里跑一次打印出来看实际值，再决定解析
方式；不同颜色函数（`color-mix()` vs 普通 hex/named color）在同一个页面上可能吐出不同语法。
