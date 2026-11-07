# Mintlify 中文标题的锚点 slug 规则

## 现象

站内链接 `[...](/zh/guides/write-send#...)` 指向中文标题时，`mint broken-links --check-anchors` 报 broken link。按 github-slugger 习惯去掉全角标点（`#参数怎么进experiment-声明adapter-消费`）或把标点换成连字符（`#参数怎么进-experiment-声明-adapter-消费`）都会失败。

## 根因

Mintlify 的 slug 规则和 github-slugger 不同：**全角标点（`：` `，` `——` `？`）在锚点里原样保留**，空格转 `-`，拉丁字母转小写。标题 `参数怎么进：experiment 声明，Adapter 消费` 的锚点是 `#参数怎么进：experiment-声明，adapter-消费`。

## 修法

写站内锚点时直接抄标题原文：保留全角标点，空格换 `-`，英文小写。现成可对照的例子：

- `connect-otel.mdx` → `#格式怎么选：默认自动，可显式指定`
- `write-send.mdx` → `#第四步：hitl-停轮与续跑`

改中文标题前先 grep 全站有没有链接指向旧锚点（`grep -rn "页面名#" docs-site/`）；改完必跑 `pnpm run docs:links` 验证（需 Node 22）。
