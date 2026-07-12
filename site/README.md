# 产品站开发入口

`site/` 是 NiceEval Landing Page。修改页面前先按当前项目依赖理解框架，不使用训练记忆中的 Next.js 约定替代本仓库版本。

## Next.js 规则

本项目使用的 Next.js 版本包含破坏性变化，API、约定和文件结构可能不同。动手前读取 `node_modules/next/dist/docs/` 中与任务相关的文档，再沿现有代码组织实现。

## 验证

```sh
pnpm run site:build
```

本地开发使用：

```sh
pnpm run site:dev
```
