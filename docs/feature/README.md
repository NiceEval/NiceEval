# 功能文档

这里是 niceeval 已经采用的当前目标功能索引。
一个功能一个子目录，子目录按需拆成功能说明、Library 用法、CLI 反馈和架构。
正文写产品最终满足的契约，不描述实现过程；代码不满足时属于实现缺口。

跨 Record、Inspection 与 Delivery 的数据边界由
[Record → Inspection → Delivery](record-report/README.md) 统一说明。Inspection 关闭读取语义，再由固定
query 或 View 交付；它不是作者可扩展的中间层。

已经定稿但尚未被产品采用为当前契约的方向放 [`../roadmap/`](../roadmap/)。
Feature 身份不声明同一时刻的源码状态；它表示后续实现与评审只能以这里的唯一目标为准。
文档先行产生的 gap 只允许暂时存在，后续代码必须与 Feature 一致。

当前查询入口是 `pnpm run repo docs feature list` 与 `pnpm run repo docs feature show`。它们只发现和投影现有 Feature，不创建结构。

## 未来的结构创建目标

Feature create 只是后续目标。未来入口会是 `pnpm run repo docs feature create`，并从共用的 [Feature Design Package](../_template/feature-design/README.md) 创建最小结构；在该命令出现于 `--help` 前，不手工复制模板或伪造收据。
Roadmap 与 Design 候选也使用这套正文文件；Feature 与 Roadmap 的正文都是已裁决的目标契约。

- `README.md`：用户为什么需要它、核心心智和入口。
- `library.md`：用户怎样 import、调用和组合，涵盖主要场景；公开形状遵守[API 设计](../api-design.md)。
- `cli.md`：命令怎样调用，各种 case 的期望输出与错误反馈。
- `use-case/`：CLI 的每个位置参数与 flag——或 Library 的每组公开 API——配一组用例文档。

  - 一篇只讲一个最小用户用例：一个问题、一次主要调用、对应反馈、边界与替代模式。
  - 同一个 flag、API 或功能有两个以上独立用途时，为它建立子目录。
  - 子目录 `README.md` 只负责解释选择哪篇，叶子文件各讲一个用途。
  - 父目录已表达能力名时，叶子文件名不重复 flag 或 API 名。
  - 契约单源仍在 `cli.md` / `library.md` 与对应功能页，用例篇只做叙事串联。
  - Feature 的 `use-case/README.md` 按 flag 或 API 分组列出各篇。
    Library 用例另附 API → 篇目对照表。
- [`feature/use-case/`](use-case/README.md)：跨 Feature 的用户目标入口，例如“提高评估速度”与“调试评估”。
  每个目标使用一个中文子目录；目录 `README.md` 只做选择路径，把读者送到能力所属 Feature 的最小用例，不在这里复制缓存、Sandbox 或报告契约。
- `reference/`：这个功能的形状从哪些外部系统学来——逐条记「是什么、学了什么、哪里有意没跟」。
  它承载的是**选型依据**，不是当前契约，所以不进 `README.md` / `library.md` / `architecture.md` 正文；正文只在需要交代出处时链过来。
  被否决的**自家**历史方案仍归 `memory/`：`reference/` 写别人的做法，`memory/` 写我们自己的弯路。
- `architecture.md`：实现应满足的模块边界、数据建模、数据流和不变量。
  数据建模先定实体关系，再给每个公开配置与结果类型的穷尽形状；未列出的字段即不存在。
- `lifecycle.md`：跨 owner 展开运行起点选择、build / start / install、Fixture、复用与收尾。
  需要描述 fresh / reuse 差异时,给出每 Invocation、每 Sandbox 实例或复用周期、每 Attempt 的次数表。

除 `README.md` 外都按功能形态选用，不为凑固定结构创建空文档。

`use-case/` 下的分类目录和叶子文件使用简短中文目标名，让路径本身能回答“为什么读这一篇”。
代码标识、CLI flag 与 API 名不翻译；需要用它们分类时写在目录 `README.md` 的标题和索引中，不把一串重复英文前缀放入每个文件名。

子目录清单见 [`docs/README.md`](../README.md)。
