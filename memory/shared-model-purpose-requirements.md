# 模型用途缺少共享静态要求与加载校验

使用方需要在多个实验间复用同一评估，并让用途名称同时约束缓存判据与 Adapter usage。
0.17.1 只能在调用 rate(slot) 时验证字符串，不能在 TypeScript 阶段拒绝拼写错误；实验也不能在计划前验证所选评估需要的全部用途。
共享模型声明与 Adapter 绑定工厂的 requires.models 是目标契约，见 docs/feature/adapters/library/README.md。
验收通过安装后的类型消费者与 CLI/SDK 计划入口；过滤条件不能隐藏缺失要求，不创建运行数据库，同一评估可复用于不同模型选择。
