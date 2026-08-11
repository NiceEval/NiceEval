# Cases

| Case | 输入 | 结果 |
|---|---|---|
| 同仓库不同 commit | 六道组内 Eval，各有完整 commit OID | 首台 Sandbox 准备一次 repository；六题切换零网络 |
| 同一 commit 重复 | 多个 Attempt 指向相同 commit | 每次仍重建干净工作树，但不重复 clone |
| 上一题污染 `.git` | Agent 写 hook、remote、ref 或 config | 下一题丢弃可写 metadata，从 seed 重新建立 |
| 首题前缺对象 | origin 不包含某个声明 commit | 组在派发首题前失败，不运行半套题目 |
| seed 损坏 | 校验失败或对象缺失 | 当前 Sandbox 退休；按 `onUnavailable` 停组或替换 |
| 实例替换 | `replace-sandbox` 创建新实例 | 新实例重新执行一次 origin 获取，再继续未派发题目 |
| 未来对象敏感 | 题目要求 Agent 看不到另一题 commit | 不使用该复用组；改用 fresh Sandbox |
