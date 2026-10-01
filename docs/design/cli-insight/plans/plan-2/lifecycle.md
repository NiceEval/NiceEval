# PLAN-2 —— Lifecycle

## Query 与 Show

`query run`、`query explain` 与每次 `show` 都是一次性 Host operation：打开 frozen view、完成 Analysis、关闭全部 Scope，再输出闭合值。进程收到中断时不输出半份成功 document。

Discovery page 同样每次重开 view。跨进程一致性只靠 `selectionSnapshotIdentity` 校验，不保持长寿 reader。

## Insight 启动

```text
parse selector and bind loopback
  → freeze target identity and descriptor catalog
  → open initial Sample(s)
  → form initial InsightRevision
  → create one-time bootstrap credential and server session store
  → report ready
  → open browser unless --no-open
```

默认 selector 是 project-current。Project selection 进入 overview；exact locator 进入 Attempt detail。Project-current 零命中仍形成可诊断 empty overview。

无效 exact locator、端口占用、Sample open failure 或首 revision 失败都发生在 ready 前。Host 关闭已经取得的资源，不留下半启动 server。

Browser open 失败不终止 server。CLI 打印同一个带短期 fragment credential 的可复制 URL。

## 浏览器授权

- 启动 URL 把高熵、单次、短期 bootstrap credential 放在 URL fragment，不放进 path、query 或 server log。
- 未授权 bootstrap HTML 不含 Record 或 Analysis 数据。
- 前端以 POST 交换 credential；Host 签发 HttpOnly、SameSite=Strict、无 Domain、限本进程 path 的 session cookie，然后前端立即从地址栏移除 fragment。
- Session 只活到 Insight 进程退出；同 origin 新标签页可以复用已经建立的 session。
- 所有 RPC、SSE 与 WebSocket upgrade 都验证 session、exact Origin 与本次 loopback Host / port。
- 没有 CORS、wildcard origin、匿名数据 endpoint 或可缓存数据响应；数据响应使用 `Cache-Control: no-store`。
- Credential 过期或已经使用且浏览器没有 session 时显示具名授权错误，不回退匿名访问。

## 更新与刷新

V1 只 watch 新 Record publication。Target identity 与 descriptor catalog 在进程启动时固定；配置、Eval、Experiment 或 descriptor 源码变化只显示 `restart required`。

Record 更新只设置 pending 标记，不修改 active revision。用户确认刷新后进入 single-flight：

```text
open candidate Sample(s)
  → form complete candidate revision
  → if failed: close candidate, keep last-good, show retry
  → if successful: atomically switch active revision
       → cancel old RPC
       → close old Sample(s)
```

多个标签页的重复确认合并到同一次构建。构建期间再次发布 Record 时，本次 candidate 仍可成为一致 revision；切换后 pending 标记继续存在，提示还有更新。

Insight 只保存 active revision 与当前 candidate，不积累 revision 历史。旧 RPC 必须带旧 identity，因此即使取消晚到也不能污染新 UI。

## 退出

SIGINT、SIGTERM 与正常退出按以下顺序收尾：

1. 停止接受新 browser request 与刷新。
2. 取消 candidate build、RPC、SSE / WebSocket 与 watcher。
3. 关闭 candidate 与 active revision 的全部 Sample。
4. 关闭共享 Record session、session store 与 HTTP server。

完成后 bootstrap credential 与 browser session 都失效。Insight 不写静态目录、current pointer、revision cache 或公共发布物。
