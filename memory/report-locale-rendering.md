# 设计裁决:report 渲染面引入 locale 与内部双语字典

- **裁决**(2026-07-11):`ReportLocale = "en" | "zh-CN"`(默认 `"en"`)进报告的**渲染面**:`renderReportToStaticHtml` / `renderReportToText` 的 options 收 `locale`,经 `WebContext` / `TextContext` 携带进每个组件面;官方组件的 chrome 文案(verdict 词、缺数据说明、composed-from 标注、坐标轴提示等)走 report 内部字典 `src/report/locale.ts`。指标 `label` 类型扩为 `string | Partial<Record<ReportLocale, string>>`,数据层(`MetricColumn.label`)原样携带、渲染面按 locale 解析;`display` 不本地化。view 把报告槽渲染两遍(en + zh-CN)烘成两个 `<template>`,壳按界面语言摆放,切语言不重算数据。
- **曾选方案与否决理由**:
  - **复用 `src/i18n/`**:否。那是 CLI 专用文案层——命令行 help、错误提示,Node 进程语境;report 组件要在任意 React 宿主与浏览器语境里成立(`niceeval/report/react` 可进 `"use client"`、静态导出),两层的受众、词表、运行环境都不同,合并会把 CLI 文案机制拖进浏览器 bundle,也会让两边的措辞约束互相牵制。
  - **`display` 一并本地化**:否。`display` 是 `unit` 驱动的 format 产物(`"87%"` / `"$0.31"`),在计算侧生成、随数据序列化——它是口径的一部分,两面、两语言必须看到同一个值显示;按语言分裂 display 意味着数据层按语言分裂,可序列化边界两侧就得协商语言,场景二(CI 落 JSON 喂 SPA)直接被搞复杂。label 是文案、display 是数,只本地化前者。
  - **数据层按 locale 生成两份**:否。locale 是渲染参数,同一份组件数据渲染成任意语言;view 的双 template 就是「一份数据、两次渲染」,不是两份数据。
- **日期**:2026-07-11。落点:`docs/reports.md`「locale:渲染面的语言」;实现 `src/report/locale.ts` 与两个渲染入口。
