# Package：安装后的外部消费

Package Repo 证明发布 tarball 在仓库外、没有源码 checkout 与 TypeScript runtime loader 的消费者中可用。它只观察 Node、TypeScript 与安装后的 `niceeval` binary 给出的公开结果，不读取候选包的 `src/` / `dist/` 布局来判定成功。

## 验收契约

### 运行时入口

- 外部 ESM consumer 用 raw Node 导入根入口和每个公开 runtime 子路径；
- 外部 CJS consumer 用 raw Node `require()` 同一组入口；
- 两面导出相同的公开能力，optional peer 缺席时不因未使用的 adapter、sandbox 或 reporter 提前崩溃；
- 安装后的 `niceeval` binary 从外部 cwd 完成最小 `init` / discovery / dry-run，不依赖 checkout、workspace link 或 `tsx` 命令包住消费者；
- Report 的公开入口与静态资源从 tarball 自身可消费，不借当前仓库的预构建目录补洞。

测试执行真实入口并断言导出能力、命令结果与退出码。`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`、`ERR_PACKAGE_PATH_NOT_EXPORTED`、缺失 asset 或从 checkout 偶然找到模块都属于产品回归。

### 同一进程的模块形态互操作

CLI 保留“宿主 `package.json` 是 `module`、`commonjs` 或没有 `type` 都能装载用户 `.ts`”的契约。一次 discovery 可以遇到由 ESM 与 CJS loader 产生的用户定义；它们必须被同一个运行时识别和消费，不能因双包身份分裂丢失私有状态。

Package Repo 至少用一次真实 CLI Journey 同时装载两种最近 `package.json` 形态，并让以下代表穿过公开 discovery / linker / run 边界：

- `defineEval` / `defineExperiment` 返回的定义值；
- 一个带私有 planner 状态的 `SandboxLayer`；
- 一个带注册状态的 Report extension 或等价稳定代表。

测试只断言这些定义被接受并产生预期公开结果，不断言实现采用 CJS canonical runtime、ESM façade、全局 registry 或其它内部方案。构建机制可以重构，但同进程只能表现为一个可互操作的 NiceEval runtime identity。

### 类型入口

仓库外 NodeNext ESM 与 CJS consumer 分别运行 `tsc --noEmit`，检查根入口和全部公开子路径。两种声明必须由同一 API 源生成并保持导出与关键推断一致；不能手工维护两套会独立漂移的类型表。

ESM 与 CJS 声明按各自模块形态发布。测试让 TypeScript 经 `exports` 找到类型，不直接指定候选包内部 `.d.mts`、`.d.cts` 或 `.d.ts` 路径。

## 安装与身份

Package Repo 本身就是外部 consumer。根 runner 在其仓库外副本中注入同一个候选 tarball、安装并核对 lockfile integrity 与 executable 身份；测试正文不得另建未安装候选的二级 consumer。

Release preflight 必须对待发布的同一 tarball运行这些场景。验收后重新 pack、在 workflow 中改写 exports，或发布与 preflight digest 不同的字节都会切断证明链。

## 不属于本 Repo

- 具体编译器、bundle/chunk 数量和发布文件目录名；
- 私有模块的 import 次数、WeakMap / Symbol 实现或源码文本；
- CLI flag 的完整错误矩阵；
- provider SDK、浏览器交互与 Record 私有磁盘格式。

这些内部实现变化只要维持上述外部结果，就不应要求修改 Package 测试。
