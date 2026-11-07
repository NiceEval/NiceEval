# showcase 子路径无尾斜杠托管时前端 artifact fetch 全 404

## 现象

niceeval.com/showcase/memory（vercel.json rewrite 到 coding-agent-memory-evals 部署）上打开 attempt 详情，源码视图报「此 run 捕获过源码，但当前部署里缺少它的 artifact 文件」，trace 同样取不到。但导出站本身是完整的：`/showcase/memory/artifact/<base>/sources.json` 直接访问 200 且内容齐全。本地 `niceeval view`（页面挂在 `/`）一切正常，容易误判成「导出没带源码」。

## 根因

前端 `artifactUrl()` 返回相对路径 `artifact/<rel>`，交给浏览器按文档 URL 相对解析。反代 rewrite / cleanUrls 会把 `<dir>/index.html` 服务在**无尾斜杠**的 `<dir>` 路径上（`/showcase/memory` 200 直出，`/showcase/memory/` 反而被平台 308 回无斜杠形态），此时文档基底目录是 `/showcase/`，fetch 打到 `/showcase/artifact/...` → 404 → 前端如实显示「artifact 缺失」。与 static-site-export-drops-sources（文件没导出）、sources 引用格式直拷（导出了但格式不对）是同一症状的第三种根因：文件在、格式对、URL 错。

排查时的两条弯路：npm 发版时间线（0.7.0 发布晚于对方 push 24 分钟，构建装到 0.6.2）是真事实但不是根因——该 bug 在所有版本都在；给 niceeval.com 加「补尾斜杠 redirect」不可行，平台的 trailing-slash 归一化会 308 弹回来形成重定向环。

## 修法

`src/view/app/lib/artifact-url.ts`：不再依赖浏览器相对解析，自己算基底——pathname 末段带 `.` 视为文件名去掉（直接打开 `.../index.html`），否则整个 pathname 就是页面目录（覆盖无尾斜杠形态），`artifact/<rel>` 拼在该目录下。前提是 `artifact/` 恒为 `index.html` 同级（导出布局保证）。契约声明补进 docs/feature/reports/view.md「静态导出」；回归测试在 src/view/artifact-serving.test.ts。适用场景：任何把导出站挂在子路径、且入口 URL 不带尾斜杠的托管。
