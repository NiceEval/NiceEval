# 设计裁决:不做 view 内建 Compare tab 与 Eval 目录页(roadmap「View 增强」删除)

## 裁决

2026-07-21,删除 `docs/roadmap/view-enhancements.md`(view 内建 Compare tab + Eval 目录页两个提案),不融入 feature。两次运行对比的能力由报告组件承担:成对差异表 `DeltaTable` 按 `"snapshot"` 维度对比任意两份结果快照,写进自定义报告页即可,view 宿主不新增内建 tab。

## 曾选方案与否决理由

- **Compare:view 里新增一个小 tab,两个下拉挑快照、出 KPI delta + per-eval 并排表**(参考 vercel agent-eval playground `/compare`):否决——提案写在旧 view 架构上(`App.tsx` 的 `navItems`、烘进 HTML 的 `viewData.snapshots`,两者都已不存在);现行 view 契约是「宿主不拥有 pages 之外的导航与详情,页面全部来自报告声明」(见 memory/reports-no-privilege-chrome-rulings),内建 tab 直接违反;且它要的能力(挑两点对比)`DeltaTable by="snapshot"` 已覆盖,为一个报告页能表达的东西给宿主开特权不值。
- **Eval 目录页:不跑先看 `evals/` 下每个 fixture 的 `PROMPT.md` 与文件列表**:否决——提案自述「没有具体设计,优先级低于 Compare」,无契约可定稿;要做时从头设计,不留占位。

## 落点

删除 `docs/roadmap/view-enhancements.md`;`docs/references.md`(agent-eval playground 两条 learnings)、`docs/observability.md`、`docs/source-map.md` 的指向改为 `DeltaTable` 契约与本条目。
