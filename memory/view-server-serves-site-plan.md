# 设计裁决:view 本地 server 与 `--out` 统一为单一站点管线(SitePlan)

## 裁决

2026-07-16,用户裁决「view 就是直接用 out 的产物」且**全功能不丢**:本地 server 与静态导出共用同一条站点管线——`src/view/site.ts` 的 `planSite()` 把结果根物化成产物清单(path → 现算内容 | 原文件引用),`writeSite()` 写盘即 `--out`,server 按清单查表服务即本地模式,同一路径两宿主逐字节一致。布局与取数知识(artifact 相对路径、sources.json 解引用)只住在 site.ts 一处。契约落 `docs/feature/reports/view.md` 开篇;奇偶由 `src/view/site-parity.test.ts` 逐字节守护,弹窗证据链行为由 `src/view/app/components/CodeView.test.tsx`(jsdom 真点击)守护。

## 曾选方案与否决理由

- **两条链路各自修**(server.ts 动态端点 + index.ts 复制管线并存):否决——同一份布局知识写两遍,历史上已两次翻车([view-sources-artifact-serving-not-dereferenced](view-sources-artifact-serving-not-dereferenced.md)、[static-site-export-drops-sources](static-site-export-drops-sources.md)),每次改落盘格式都要人肉记得改两处。
- **view = 先真实导出到临时目录再静态服务**:否决——大结果根(百 MB 级 trace)每次起 server 全量拷盘;清单引用原文件即可达到同等字节一致,启动仍是瞬时。

## 全功能保全清单(宿主语义,全部作用在管线输入端)

- 首页请求触发整份产物重建 → 数据永远盘上最新(旧「每次请求现读现算」语义等价保留);`--report` mtime cache-busting 照旧。
- artifact 未命中最近清单时重建一次再查 → server 运行期间新落盘证据无需重启。
- 单页渲染失败:server 折成页内错误块(embed),导出仍整体失败。
- 收窄(位置前缀/--experiment)只在本地模式;`--out` 互斥、发布防呆、`--snapshot`、`--port` 顺延、healthz、legacy `/artifact?p=` 全部保留(旁路取数被删:清单之外的路径 404,o11y.json/result.json 不再可越权取)。

## 附带发现

- 触发排查的「线上 send 无回复」真实根因**不在两宿主差异**(线上/本地渲染一致):bub 事件流里的内部续跑 user 消息打断了前端 `indexTurns` 的轮归属;修复由并行工作完成(轮归属按 loc 判定,契约在 view.md「Attempt 详情」与 events.md 不变量 8)。
- 顺手修掉 docs-site zh 六页残留的旧 flag `--run`(0.7.0 起是 `--results`/`--snapshot`)——线上 Vercel 构建失败正是照抄旧文档命令。
