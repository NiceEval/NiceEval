# 配置损坏或异常中断时：利用原生 CLI 直接管理沙箱

## 解决什么问题

在进行评测配置调试或重构时，`niceeval.config.ts`、测试集文件或 Adapter 代码可能处于语法错误或类型报错的损坏状态。同时，若此前评测曾留存了沙箱，或者进程曾遭遇 `SIGKILL`、断电强杀而遗留了无主沙箱，开发者需要确认哪些沙箱还在运行、并销毁不再需要的容器。

如果沙箱的列出与销毁强依赖 NiceEval 内部的 CLI 或配置求值，那么只要配置文件存在语法错误，用户连销毁残留容器都无法执行。

将沙箱管理与连接彻底交由底层 Provider 的原生 CLI，能够保证：**无论上层 NiceEval 项目如何损坏、代码如何报错，底层原生 CLI（`docker` / `instabox`）永远不受影响，随时开箱即用。**

## 全流程

### 1. 查看存活与留存的沙箱列表

当项目配置无法加载或处于编译报错时，直接使用宿主上的成熟命令查看当前存在的沙箱：

- **Docker Sandbox**：
  NiceEval 创建的容器均带有统一标签标识，使用标准 `docker ps` 即可一目了然：

  ```bash
  # 列出所有由 NiceEval 启动的存活或停驻容器
  docker ps -a --filter "label=niceeval"
  ```

  输出清晰展示当前容器的 CONTAINER ID、镜像、创建时间与运行状态。

- **Instabox Sandbox**：
  直接使用 Instabox 原生客户端查询账号下活跃的沙箱：

  ```bash
  instabox list
  ```

### 2. 销毁指定的残留沙箱

直接使用 Provider 的原生删除命令销毁目标沙箱，无需启动 Node 进程或求值配置文件：

- **Docker**：

  ```bash
  # 强制删除指定沙箱
  docker rm -f a3f9c2d1
  ```

- **Instabox**：

  ```bash
  # 销毁指定的云端沙箱
  instabox rm niceeval-97511d9a
  ```

### 3. 批量销毁所有残留与孤儿沙箱

在发生进程强杀、崩溃导致一批沙箱未被收回时，利用原生管道或 Provider 自带的 prune 能力一键回收：

- **Docker 批量销毁 NiceEval 残留容器**：

  ```bash
  docker rm -f $(docker ps -aq --filter "label=niceeval")
  ```

- **Docker 回收无主悬空资源**：

  ```bash
  docker container prune -f
  ```

## 结果

沙箱实例的底层归属始终属于 Provider 本身。不自建内部注册表和中间回收工具，使得：
1. 即使当前项目的 TypeScript 源码无法编译、配置文件缺失或存在语法错误，资源的可见性与销毁路径永不被阻断；
2. 开发者和系统运维可以直接沿用现有的容器运维习惯（Docker Desktop、Portainer、系统定时脚本等）监控和管理资源。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 原生 CLI 现场接入与资源管理。
- [在现场反复验证假设](sandbox-retain-validate-scene.md) —— 调试定位与假设检验。
