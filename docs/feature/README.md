# 功能文档

这里是 niceeval 已定稿目标功能的索引。一个功能一个子目录，子目录按需拆成功能说明、Library 用法、CLI 反馈和架构。正文写产品最终要满足的契约，不描述当前实现状态；代码尚未满足时，后续工作是实现契约。

仍有开放分歧、尚未定稿的功能放 [`../roadmap/`](../roadmap/)，不放在这里。

新开一个功能子目录，从 [`_template/`](_template/README.md) 起步：

- `README.md`：用户为什么需要它、核心心智和入口。
- `library.md`：用户怎样 import、调用和组合，覆盖主要场景。
- `cli.md`：命令怎样调用，各种 case 的期望输出与错误反馈。
- `architecture.md`：实现应满足的模块边界、数据流和不变量。

除 `README.md` 外都按功能形态选用，不为凑固定结构创建空文档。

子目录清单见 [`docs/README.md`](../README.md)。
