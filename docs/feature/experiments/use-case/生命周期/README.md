# 生命周期代码放哪 ——用例

判断顺序是：资源随什么变化、活在哪一侧，就放进对应层。

| 目标 | 用例 |
|---|---|
| 准备稳定且安装很慢的基础依赖 | [把重依赖烘进镜像](../lifecycle-bake-dependencies.md) |
| 准备某道 Eval 自己的任务素材 | [准备任务 Fixture](../lifecycle-task-fixture.md) |
| 按 Experiment 改变 Sandbox 内配置 | [配置 Sandbox 准备命令](../lifecycle-configure-sandbox-prep.md) |
| 整场运行共享一个临时服务 | [启动实验级共享服务](../lifecycle-shared-services.md) |
| 服务需要跨 Run 长期存在 | [交给外部编排](../lifecycle-external-long-lived-resource.md) |

完整分工见 [Sandbox 预置分工](../../../sandbox/library.md)。
