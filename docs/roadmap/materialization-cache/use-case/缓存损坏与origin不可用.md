# 缓存损坏与 origin 不可用

已有 SourceProjection 且完整性复核通过时，即使 origin 暂时不可用，Attempt 仍能零网络建立 repository。

若投影 payload、manifest 或 identity 不一致，它转为 `unverified`，不再命中：

- SourcePool 已包含 commit 所需对象时，从 pool 重建投影，不访问 origin；
- pool 缺失 coverage 时，尝试从 origin 补齐；
- origin 同时不可用时，Attempt 以具名 host preparation failure 结束，不创建 Sandbox。

若损坏在 payload 已进入 Sandbox 后才被发现，该 Sandbox 被标记 tainted 并退休。
系统不会把“再跑一次 `git fsck` 成功”当作恢复复用资格的证明。
