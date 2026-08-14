# Fixture 内容命令 —— Architecture

## Planning

`putFixture()` 在定义期立即委托 `registerSandboxContent(options.source)`。
既有 discovery capture 遍历文件树、计算 digest，并产生 RegisteredSandboxContent。

import module 会按现有 content registration 契约读取并哈希本地 fixture，但不执行 Sandbox I/O。
source 必须是由定义模块显式构造的 `file:` URL；缺失或包含不支持的节点时，沿用 content registration 的定义错误。

## Identity

稳定 command identity 是：

```text
fixture-command/v1
  + id
  + revision
  + content kind
  + content digest
  + declared target
```

宿主绝对 source path 不进入公共 identity。
Record 只保存 kind、digest 与声明的 target；宿主 source locator 不成为可携带契约。

source 内容变化自动改变 digest。
只移动 source 而内容不变时，内容身份不变。
调用处源码因移动 source 而变化时，execution source fingerprint 仍按源码闭包正常变化；内容 identity 相同不会跳过这道门。

## Execution

命令在 owner layer 的 `prepare()` 顺序中执行。
每个 Attempt 都调用一次 `putContent()`；大文件分块、临时写入与原子替换复用现有传输协议。

Sandbox reuse 不改变 cadence。
reset 后命令重新放置内容，不能因为上一条 Attempt 曾经上传就跳过。

## 失败归属

| 失败 | 归属 |
|---|---|
| source planning / digest 失败 | definition / planning error |
| Provider 写入、timeout、transport | `sandbox.prepare.<owner>` |
| target path 非法 | command author error |
| 原子替换失败 | `sandbox.prepare.<owner>` |

命令不会把 missing source 当空目录，也不会留下半写 target 后继续 Agent。

## 安全边界

fixture 是 Agent 应当看见的起始材料。
隐藏 solution、rubric、private key 与判分脚本不能通过 `putFixture()` 送入主 Sandbox。

这项限制由现有 leak gate、build context 与 criteria/private 契约共同执行。
wrapper 不建立旁路 allowlist，也不降低现有 symlink 与边界检查。
