# Bug 组：静态产物必须在真实 URL 基底下闭合

这一组用 attempt 链接在无尾斜杠子路径下 404 作正例，用 artifact fetch 的同形 404 作反证。
它完全复用设计已有的 `hosting: "clean-url-subpath"`、真实浏览器和领域下钻，不新增原语。

## 正例：locator 点击只改 hash，dialog 不开

fix commit `f055aa67` 前，同一份导出站在本地 `/` 正常，挂到 `/showcase/memory` 时 attempt 相对链接被浏览器解释到 `/showcase/attempt/...`。
cleanUrls 平台还会把带尾斜杠形态 308 回无斜杠，补 redirect 不能解决。

用户可见事实是公开 locator 链接不可达，而不是 HTML 文件缺失。
本地 server 永远用目录 URL，`file://` 又永远带文件名；已有两个托管形态都绿，漏掉的正是无尾斜杠索引 URL。

fix 在 index head 最前设置目录形态的 base，并避免切 tab 时把 pathname 改写。
新增 `site-base.test.ts` 验证 base 计算，但真实浏览器下钻仍应由 hosting matrix 守住：

```ts
reportBehavior(cleanUrlSubpathKeepsTargetsAndArtifactsReachable, async () => {
  const ui = await openSite(w.exportDir("site"), { hosting: "clean-url-subpath" });
  const target = w.target("tool-call-attempt");

  await ui.expectTargetDoc(target);
  await ui.targetLink(target).click();
  await expectWeb(ui.dialog()).toBeVisible();
  await expectWeb(ui.dialog()).toContainText("Brooklyn");
  await expectWeb(ui.dialog().getByText("evals/tool-call.eval.ts")).toBeVisible();
});
```

最后一条使用 Playwright 原生定位，证明 artifact 内容实际加载；不新增 `artifactFetched()`。

## 同形反证：文件存在，artifact URL 仍错

fix commit `f3dcb393` 处理过相同托管形态下的 source / trace fetch。
导出目录中文件完整，前端却把 `artifact/<rel>` 解析到父目录，页面误报“部署缺 artifact”。

该 fix 加了 URL 纯函数单测，却没有真实 clean-url 托管。
上面的一个浏览器 proof 同时覆盖两条旧 bug：dialog 不开时停在 target 下钻；dialog 开但 source 缺失时停在 artifact 内容。
这证明 hosting 是 world 形态，不应分别给链接和 fetch 写两个 URL matcher。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 断 locator、dialog 与公开 source 身份，不锁 base 标签实现 |
| 不能改断言放行 | hosting recipe 固定无尾斜杠入口与 308 行为，不能换成本地 `/` |
| 观察失败显式报错 | 链接缺失、点击后 dialog 缺失、artifact 请求失败分阶段报告 |
| 用户侧直接定位 | 消息含入口 URL、最终请求 URL、HTTP 状态、locator 与截图 |
| 设施不造假 | server 真实模拟 cleanUrls；浏览器启用 JS；同目录产物不改写 |
| 用户已有用法不改 | 同一份 `view --out` 产物和公开 locator 链接 |
