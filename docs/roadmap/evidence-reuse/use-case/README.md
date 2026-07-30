# Evidence 复用政策 —— 用例

这些用例故意保留“同一种改动、不同意图”的冲突。
系统先记录事实，再按 [Policy Models](../policy-models.md) 选择默认动作，最后应用用户授权。

## 冲突矩阵

| 表面变化 | 实际意图 | 角色或事实 | 证明优先 | 复用优先 | 用户权限 |
|---|---|---|---|---|---|
| Eval 加注释 | 纯解释文字 | source delta | 重跑 | 重跑 | `--accept source:<path>` |
| Eval 加注释 | 注释会进入 prompt 或 fixture | source delta | 重跑 | 重跑 | 不应接受 |
| `.env` URL 变化 | 新隧道通向同一资源 | connection + 同一 resource identity | 沿用 | 沿用 | 无需覆盖 |
| `.env` URL 变化 | 指向另一套被测实现 | condition delta | 重跑 | 重跑 | 可接受 condition，风险自担 |
| `.env` URL 变化 | 后端身份无法观测 | opaque resource | 重跑 | 沿用并标 unverified | accept opaque / rerun resource |
| API key 轮换 | 只改变访问权 | secret | 沿用 | 沿用 | 无需覆盖 |
| Sandbox setup 改 URL | 只换包代理 | connection + 依赖身份未变 | 沿用 | 沿用 | 无需覆盖 |
| Sandbox setup 改 URL | 换成另一份工具或数据源 | condition/resource delta | 重跑 | 重跑 | 可接受精确原因 |
| Hook 闭包值变化 | 系统无法取得声明式身份 | opaque Sandbox | 重跑 | 沿用并标 unverified | accept opaque / rerun sandbox |
| 外部服务清库 | observer 版本变化 | resource delta | 重跑 | 重跑 | 可接受 resource，风险自担 |
| 外部服务可能清过库 | observer 缺失 | opaque resource | 重跑 | 沿用并标 unverified | accept opaque / rerun resource |

矩阵里的“可接受”表示框架允许用户作精确、可审计的风险授权，不表示产品推荐这么做。

## 按场景进入

| 改了什么或想做什么 | 用例 |
|---|---|
| Eval 注释、格式、prompt 或断言 | [修改 Eval 源码](修改Eval源码.md) |
| `.env`、隧道 URL、endpoint 或 API key | [环境变量与连接地址](环境变量与连接地址.md) |
| 清空或更换被测服务状态 | [归零被测服务状态](归零被测服务状态.md) |
| Sandbox recipe、Hook、镜像或下载地址 | [修改 Sandbox 预置](修改Sandbox预置.md) |
| Agent 工厂开关参数 | [修改 Agent 工厂参数](修改Agent工厂参数.md) |
| Eval 读取数据文件 | [读入数据文件](读入数据文件.md) |
| 跨 Run 对照被口径变更切断 | [跨 Run 对照](跨Run对照.md) |

每篇固定回答四件事：系统能观察到什么、两套默认政策分别怎样做、用户可以覆盖什么、什么应该改成长期声明而不是每轮传 CLI flag。
