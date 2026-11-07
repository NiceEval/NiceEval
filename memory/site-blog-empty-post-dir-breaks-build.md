# site 博客空 post 目录会把 site:build 整个炸掉

## 现象

`pnpm run site:build` 在 "Collecting page data" 阶段直接失败:

```
Error: ENOENT: no such file or directory, open '.../site/src/blog/posts/<slug>/en.mdx'
> Build error occurred
Error: Failed to collect page data for /[lang]/blog/[slug]
```

工作树里只要 `site/src/blog/posts/` 下存在一个没有 `en.mdx` + `zh.mdx` 的目录(比如给未来文章占位的空目录),整站构建就失败。git 不跟踪空目录,所以 `git status` 干净、CI 可能是好的,只有本地炸——很容易误判成自己刚改的代码有问题。

## 根因

`site/lib/blog.ts` 的 `getAllBlogPosts()` 对 `posts/` 下每个目录无条件 `readFileSync` 两个语言的 mdx,不存在就抛 ENOENT。首页/博客索引/文章页的 `generateStaticParams` 和 JSON-LD 都调它,build 时必然执行。

## 修法

- 临时解法:把空目录移走再 build,或补齐两份 mdx(可以 `status: "draft"` 起步——draft 会被列表过滤,但文件必须存在且 frontmatter 完整:title/description/date/category/readMinutes)。
- 如果这种占位目录常态化,考虑在 `getAllBlogPosts()` 里跳过缺 mdx 的目录并 console.warn,而不是抛错;目前保持 fail-fast 未改。
- 另注意:所有 post 都是 draft 时,`/[lang]/blog/[slug]` 一个静态页都不产出,访问任何 slug 都 404,这是 draft 过滤的预期行为不是 bug。
