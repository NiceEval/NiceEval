# Nx 项目图与维护任务

Nx 项目图记录仓库项目和依赖。构建、lint、typecheck 与依赖更新据此确定会受影响的项目，执行仍使用各项目与根 `package.json` 声明的正式入口。测试的 CI 与运行规则见[测试架构](../testing/architecture.md#运行)。

## 项目布局

`apps/` 放可部署应用，`packages/` 放供其它项目复用或发布的包。应用可以依赖包。文档站的随包内容进入发布包输入，Landing Page 独立部署。

项目的 `project.json` 声明身份、任务输入和 Nx 无法从源码推导的依赖。共用输入属于声明它的项目，依赖关系在图中表达。维护基线用根 `package.json` 锁定的 Nx 版本。

新增或移动项目时，核对它的 `project.json`、workspace 纳入规则、根入口及部署输出。目录移动时保留项目的稳定名称。可用 `pnpm exec nx show project <name>` 核对新路径与依赖。

## 构建与静态检查

项目级构建、格式与类型检查引用自己的输入和依赖。仓库级校验使用根脚本，例如 `pnpm lint` 和 `pnpm typecheck`。影响包入口的改动按[仓库工具](../repository-tools/README.md)验证打包入口。

## 依赖更新

检查 manifest 和 lockfile 的改动归属。直接依赖、传递解析、peer resolution、integrity 和补丁变化都可能影响构建与类型检查。先定位对应 importer，再核对图上的下游项目。

共享工具、根 workspace 约束或无法完整解释的 lockfile 变化，使用仓库入口覆盖项目图。已确认只影响单个 importer 的变化，可从该项目和图上的消费者开始验证。
