# 功能文档

这里是 niceeval 已定稿目标功能的索引。
一个功能一个子目录，子目录按需拆成功能说明、Library 用法、CLI 反馈和架构。
正文写产品最终要满足的契约，不描述当前实现状态；代码尚未满足时，后续工作是实现契约。

仍有开放分歧、尚未定稿的功能放 [`../roadmap/`](../roadmap/)，不放在这里。

新开一个功能子目录,从共用的 [Feature Design Package](../_template/feature-design/README.md) 起步。
Roadmap 与 Design 候选也使用这套正文文件;这里额外要求所有正文都是已裁决的目标契约。

- `README.md`：用户为什么需要它、核心心智和入口。
- `library.md`：用户怎样 import、调用和组合，覆盖主要场景；公开形状遵守[API 设计](../api-design.md)。
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

除 `README.md` 外都按功能形态选用，不为凑固定结构创建空文档。

`use-case/` 下的分类目录和叶子文件使用简短中文目标名，让路径本身能回答“为什么读这一篇”。
代码标识、CLI flag 与 API 名不翻译；需要用它们分类时写在目录 `README.md` 的标题和索引中，不把一串重复英文前缀放入每个文件名。

子目录清单见 [`docs/README.md`](../README.md)。
