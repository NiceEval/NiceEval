# Mintlify MDX 渲染 HTML 的四个坑（GitHub 式 diff 页踩出来的）

## 现象

在 `docs-site/zh/example/ai-sdk-v7-before-after.mdx`（由 `scripts/gen-diff-code.ts` 生成）里用原生 HTML 做 GitHub PR 式 diff 表格时：

1. `<details>` / `<summary>` 整个元素被 Mintlify 剥掉，DOM 里完全不出现。
2. `<table>` 内部标签（`<tbody>`、`<tr>`）如果分行写，行间换行会变成文本节点；`mint validate` 照样通过、SSR HTML 里也有内容，但浏览器 hydration 时 React 因 `<tbody>` 里出现文本节点而把**整块表格静默丢弃**——页面上两个 h2 之间空白，无任何报错。
3. ```` ```diff ```` 语言代码块只有普通语法着色，没有 GitHub 红绿行背景；红绿行的官方途径是 Shiki notation 注释（`// [!code ++]` / `// [!code --]`，渲染时剥掉），但它做不了行号和文件头栏。
4. （2026-07 新增）页面里同时存在 **markdown 管道表格（GFM table）和超长单行 JSX**（diff 表一行 7 万~10 万字符）时，MDX 编译直接 `Maximum call stack size exceeded`，页面渲染成「A parsing error occured」。管道表格放在文档任何位置都触发（文首/文末都试过）；删掉管道表格、或把它换成 JSX `<table>` 就正常。`mint validate` 和 `mint broken-links` 都**查不出来**，只有 `mint dev` 的 stderr 有 `MDX failed to parse page` 警告。

## 根因

- Mintlify 的 MDX → React 管线对 HTML 元素有白名单式处理，`details/summary` 不在内；`div`、`table`、`span` 都可用（带 `className`，配仓库里任意 `.css` 文件，Mintlify 自动全站加载）。
- MDX 把 JSX 流式块里标签间的换行解析为文本子节点；对 `div` 无害，但违反 `<table>` 的内容模型，React hydration 校验失败后丢弃整个子树，且不落任何构建期错误。

## 修法

- diff 表格：整个 `<table>...</table>` 拼成**单行**输出、标签间零空白（见 `renderFileDiff`）。
- 折叠容器：不用 `details`，用纯 `div`。
- 红绿 diff：生成时用 Shiki `codeToTokens` + `themes: { light: "github-light", dark: "github-dark" }` 自产 token span，颜色收敛成小调色板 class 写进生成的 `docs-site/github-diff.css`；深色模式选择器是 `.dark`（Mintlify 用 Tailwind class 策略）。
- 排查这类「validate 过了但页面空白」的问题：先 `curl` 页面对比 SSR HTML 与浏览器 DOM——SSR 有、DOM 没有 ⇒ hydration 丢弃，查非法嵌套/文本节点。
- 交互（如 diff 折叠展开）：仓库里的 `.js` 文件和 `.css` 一样被 Mintlify 自动注入（内联进页面，不是 `<script src>`，检测时别按 src 查），用事件委托写就不怕 SPA 换页；新增 `.js` 后 `mint dev` 要重启才生效。
- `tr` 上挂背景色在 Safari / 非整数缩放下行间会出 hairline，背景要挂到 `td` 上。
- 生成页里需要表格（如变更统计）时**一律用单行 JSX `<table className="gd-summary">`**，不要用 markdown 管道表格（坑 4）。排查方法：`npx mint dev` 起本地服务，`curl` 页面 grep `A parsing error`，stderr 里能看到具体是哪个页面编译失败。
