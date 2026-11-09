# Eval 发现与外部根检查

本地 Eval 与 [外部挂载根](library/sharing.md) 共用发现、前缀选择与运行命令。
安装、升级与发布由项目 package manager 负责，NiceEval 不提供另一组依赖管理命令。

## list

```sh
niceeval list [<eval-prefix>] [--json]
niceeval list --preflight [--json]
```

`--preflight` 只查找直接 dependency、root 与去凭据的精确安装身份，不导入外部 Eval。
它展示 dependency key、package、root、挂载点和 `InstalledPackageIdentity`，使用户先核对将执行的依赖。
其字段使用 [Library 的安装身份](library/sharing.md#安装身份)，不另建安装锁。

普通人读 `list` 先展示同一 preflight，再导入本地与外部 Eval。
JSON 模式只输出 JSON，发现结果中每条 Eval 的 `origin` 与 [ExternalEvalOrigin](library/sharing.md#安装身份) 相同；本地条目省略该字段。

人读发现结果显示最终 Eval id 与 package owner。预期输出示例：

```text
EVAL                              SOURCE
local/smoke                       project
terminal-bench/hello-world        terminal-bench@1.0.0
```

位置参数按项目内 Eval id 前缀过滤。零匹配时报错并列出已发现前缀，不以空列表成功退出。
最终 id 冲突不能按扫描顺序替换；诊断同时列出双方文件、package、root 与挂载点。

发现检查直接依赖、真实 root、默认导出、相对 id、owner 内静态模块、Node 支持与可判定的 NiceEval export 相容性。
既有隐藏输入泄漏检查仍生效；运行时才取得的文件按原 Eval 生命周期报错。

## 运行前计划

```sh
niceeval exp codex terminal-bench/hello-world --dry
niceeval exp codex terminal-bench/
```

`exp` 不增加 package 参数。Experiment 的 `evals` 与 CLI 前缀继续选择普通项目内 id。
包含外部 Eval 的 dry 摘要补充 package 计数；预期输出示例：

```text
evals  12 selected · 12 from terminal-bench@1.0.0
```

逐 Eval 的 source、dependency、runtime revision 与 transfer 输入变化由 [identity manifest](../experiments/architecture/cache.md#外部-eval-的身份与携带) 解释。
其余计划、资源和退出边界沿用 [Experiments CLI](../experiments/cli/README.md#--dry)。

## 外部根错误

| code | 触发条件 | 处理 |
| --- | --- | --- |
| `eval-root.package-undeclared` | package 不是消费项目直接依赖 | 声明精确依赖并安装 |
| `eval-root.package-uninstalled` | 已声明但安装树缺 package | 执行项目的 frozen install |
| `eval-root.outside-package` | root 真实路径逃出 package | 把 Eval 与资产纳入 package |
| `eval-root.missing` | 安装内容没有指定 root | 修配置或选择含 Eval 的交付内容 |
| `eval-root.node-unsupported` | Node 不支持同步 ESM/CJS 查找 hook | 使用 Node >=22.15 |
| `eval-root.niceeval-api-incompatible` | linker 确认消费运行时缺少被引用的 API | 升级消费 NiceEval 或固定相容 package |
| `eval-root.duplicate-relative-id` | 外部根内入口产生重复相对 id | 修正上游目录结构 |
| `discovery.duplicate-id` | 多根产生同一最终 id | 修改挂载前缀或冲突入口 |

诊断给出 package、root、挂载点与已知文件。API 不相容错误另给 specifier 与消费版本。
CJS 属性读取或动态访问无法由 linker 确认时，保留带 package origin 的普通发现或执行错误，不回退到另一版 NiceEval。

`list`、check 与 dry 可能执行 Eval 顶层代码，package 安装也可能执行 lifecycle script。
preflight 不证明依赖可信；挂载不改变可执行依赖的审查责任。

## 验收边界

公开命令须验证 preflight 不导入外部 Eval、前缀与零匹配、纯 JSON、alias、多根冲突，以及 origin 的稳定序列化。
真实安装验收还须满足 [装载矩阵](architecture.md#装载验收)，不能用多扫描一个目录替代完整共享规则。
