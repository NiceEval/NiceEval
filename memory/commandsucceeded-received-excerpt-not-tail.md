# commandSucceeded 失败摘录给了输出中段,契约要的是尾部

## 现象

MemoryBench dogfooding(2026-07-30):pytest 判分失败时,终端摘要的 received 摘录落在
uv 装包噪声上(`…oading pygments Prepared 5 packages in 95ms …`),看不到尾部的
`N failed, M passed` summary,失败原因要去 result.json 里挖。

## 根因

契约本来就是「received 首行 = 退出码 + stdout/stderr 合并后的**末尾**摘要」
(docs/feature/assertions/library/display.md「命令结果」段,理由是测试 runner 的诊断
惯例在尾部)。实现取窗位置不对,属实现违约,不是契约缺口。2026-07-30 同批裁决
`commands.json` 落盘不截(record/architecture.md 证据 registry,「失败诊断的完整语义
单位」),「记录层保头 256 KiB、展示层再取尾拿到中段」这条两层规则叠加出的路径随之不存在。

## 修法

已修(2026-07-30,`src/context/context.ts` 的 `previewCheckedValue` + `mergeCommandOutput`)。
真根因有两个叠加:合并顺序曾是 stdout 在前 stderr 在后,包装器噪声(uv/npm 装包走 stderr、
时序在 runner 之前)恰好落在合并末尾;摘录窗口 159 字符比 human 面 100 字符行预算宽,行收口
从头砍掉的正是失败计数。修为 stderr 在前 stdout 在后合并(合并顺序已钉进 display.md)+
摘录窗口收到 76 字符让整段活着走完终端行。回归在 `src/context/context.test.ts`
(前段装包噪声 + 尾部 `2 failed, 14 passed`,断言摘录含 summary 不含噪声)。
