# Reports 用例

契约单源始终在 [Report Library](../library.md)。本目录按用户目标说明单目标 `show` 怎样呈现一页，以及 view 与静态目录怎样从同一份
ClosedSiteRevision 呈现完整站点。

- [比较质量与成本](比较质量与成本.md)：在固定分母上保留 Evidence 后比较多个 Run 的质量、时长与成本。
- [审阅一次 Run 的闭合结果](审阅一次Run怎样采用结果.md)：从 Run ID 核对固定 Sample，再沿 locator 下钻 immutable Attempt 与 File Changes 轨迹。
- [核对数据完整度](核对数据完整度.md)：让 partial、empty、unsupported、failed、File Changes 空态与 RecordAttachment 问题保持可见。
- [分享静态报告站](分享静态报告站.md)：导出断网可读的完整页面、下载 closure 与自包含目录。
- [制作可访问页面](制作可访问页面.md)：让 text、表格与 Web 阅读共享同一事实与状态。

每个用例都从 CLI 已选择的 Sample 开始。`show` 只执行选中的 Page；view 与静态目录才完整枚举、关闭和校验后形成
ClosedSiteRevision。renderer、HTTP 请求和浏览器导航都不能回到 Record 或再次取数。

先用 `show` 读取一页，再按需要启动 `view` 或导出静态站：

```console
$ niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
Overview
  12 Eval results · details: niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --page /overview

$ niceeval view --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --no-open
niceeval view — open in a browser:
http://127.0.0.1:4400/
```

第一条只关闭 `/overview`。第二条在监听前关闭整站；若完整构建失败，不会用一部分新页面替换旧 revision。
