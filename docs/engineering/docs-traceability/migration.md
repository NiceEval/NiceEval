# Concord 迁移与图示实践

本页定义已有文档和测试关系迁入 Concord 时的保真原则。节点和关系模型见 [文档追溯契约](README.md)，图示配色见 [SVG 视觉契约](../../SVG-DESIGN.md)。

## 先确认 owner，再迁移内容

按当前目标、未来方向、候选比较、研究输入和工程机制选择 Feature、Roadmap、Design、Research 或 Engineering。Memory 保存问题、裁决与经验，不能代替产品契约。

迁移前固定实际 checkout、branch 与输入分支 commit，保存原始 metadata 和正文摘要。通过目录入口查找现有 owner；已存在的主题直接维护，不因工具变化复制第二套正文。

节点只保留一个文件开头的 frontmatter。普通 supporting page 不声明第二套节点 metadata；嵌在正文中的旧 frontmatter 要核对其含义，再清除已被正式 metadata 取代的重复内容。

原生 host 负责 collection，仓库治理配置负责声明套件。声明目录与实际消费项目对应；全部消费项目都须声明，包括 Adapter 套件。Concord suite ID 使用合法 slug；NiceEval 的 Repo ID 可以包含斜线，host 按声明目录关联两者。不能因为 host 能找到测试，就认为静态关系扫描也包含它们。

新增结构使用当前安装包的具名命令；先读 `--help`，再选择模板页。修改正文使用最新整文件 digest 和受管 author/page 命令。索引链接随正文一起维护，避免新增页无法发现。

## 合并旧分支时保持语义

源码采用双方仍有效的行为，Concord 注释继续紧邻对应声明。函数新增 overload 时，代码关系注释放在具有函数体的 implementation 前，不能绑定到无函数体的 signature。

旧测试 JSON 不能与声明旁的关系并存。对比合并共同祖先和输入分支，将新增关系落到实际 case 的注释；历史事件和 tombstone 原样归档，不把文件级关系复制给每个 case。

离线迁移保留历史 evidence 文件和指针。旧 fixed 声明保存为 attested 历史事实，不能据此生成当前有效的 red、green 或 reliability certificate。需要证明新候选时，重新通过正式 runner 获取证据。

Memory 迁移收据逐条保存输入路径、目标路径、原始 metadata、输入摘要、正文摘要和目标摘要。正文不因 metadata 转换而润色。历史状态与当前验证分别陈述。

## 图示按读者需要选择

一张图回答一个问题，先写清参与者、关系、状态或横纵轴。图中名称沿用正文术语；API 形状、约束和资源所有权仍在正文完整定义。

| 读者需要理解的内容 | 图示方式 | 交付内容 |
| --- | --- | --- |
| 少量节点的依赖、时序或状态转移 | Mermaid | 可读的声明源码与正文说明 |
| 固定布局、精确标注或适合导出的静态关系 | SVG | SVG 源码、标题与描述 |
| 多层布局、密集关系、参数变化或需要交互的复杂图 | p5.js | 绘图源码、明确输入、交互说明与静态预览 |

复杂程度由读者能否追踪关系决定，不以节点数量单独判断。先尝试拆成总览和局部图；确实需要自定义布局或交互时采用 p5.js。

p5.js 源码和资源放在主题自己的 assets 目录，从正文链接。固定布局参数和示例输入；包含随机布局时固定 seed。参数变化应让读者看到原因与结果，不能用动画替代关系说明。

静态预览与源码来自同一组输入，正文提供文字说明。GitHub 或其它静态阅读入口即使不能运行交互，仍能读懂关键关系。实际渲染接入须以消费端支持为准，不能假定任意 Markdown 的 p5 代码块都会执行。

## 验收与交接

迁移后运行 `pnpm exec concord check --json` 与 `pnpm memory check --json`。测试关系变更还需新鲜的 native collection 与 `pnpm run repo docs test audit --json`，分别核对缺少测试关联的用例、未关联 case、缺失关系及孤立关系。

运行 `pnpm typecheck` 和 `pnpm lint`。涉及运行时行为的合并，用安装后的候选公开入口执行最小 E2E 切片；collection 和关系校验不证明运行结果。

图示逐项检查正文命名、标签可读性、静态预览、交互与源码入口。检查或执行失败时说明具体阻塞和未验证范围，不能把历史证据、构建成功或提交成功当成实际验收。
