# Fixture 内容 action —— Architecture

## Planning

`uploadFile()` 与 `uploadDirectory()` 在 planning 时读取本地内容并冻结规范化 manifest。Action identity 包含 manifest digest、目标、action id、changeFrequency、依赖边、owner 与祖先 PrefixKey。宿主绝对路径、mtime 与目录遍历顺序不进入 identity。

内容读取与 Sandbox 写入是两个步骤。Planning 只产生不可变内容 handle；replay 时 Provider 把 handle 原子写到 staging Sandbox，成功后才允许 capture。传输失败不能留下可被命中的部分目标。

## Provider 恢复

`persistent` Provider 可以跨 Invocation restore；`invocation-local` Provider 在本次运行内复用；`unsupported` Provider 真实上传。三档只改变成本，不改变目标内容、owner、执行顺序或 satisfaction fact。

## 可见时点

Agent 前 fixture 是 before action，可以进入准备前缀。隐藏 tests、runner、solution 与参考答案只登记 `SandboxContent`，并在 Agent 返回后的 Eval test 中上传。Provider 可以用不可变 overlay 优化该次传输，但不能恢复一份曾在 Agent 前包含隐藏材料的状态。

## 安全边界

- 本地内容解开符号链接后必须位于声明根内。
- 内容 handle 与 manifest 不包含 secret；secret fixture 使用私有 callback。
- 目标写入只能改变当前 Sandbox，不能写宿主或外部服务。
- 同一 digest 不授权跨 trust domain 读取内容；cache domain 继续约束对象可见范围。
