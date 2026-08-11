/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // app/[lang]/layout.jsx 是唯一的 root layout,没法用普通 not-found.jsx 拼出全局 404,
    // 需要 app/global-not-found.jsx 接管未匹配路由。
    globalNotFound: true,
    // CSS 只有几 KB 且以首访流量为主:内联进 <head> 消掉渲染阻塞的 CSS 请求,压 FCP/LCP。
    inlineCss: true,
    // next@16.3 默认开启 useTypeScriptCli,要求 typescript/bin/tsc;本仓库用
    // @typescript/typescript6 别名(仅 bin/tsc6),退回 API 模式检查类型。
    useTypeScriptCli: false,
  },
  async rewrites() {
    // 英文正式 URL 不带语言前缀;根路径 rewrite 到 /en 渲染源。
    // 用 route-level rewrite 而不是 proxy:rewrite 后的 /en 会再次进入 proxy 被 308
    // 弹回根路径,形成 / → /en → / 的无限重定向环。
    return [
      {
        source: "/:path((?!_next|docs|showcase|zh|.*\\..*).*)",
        destination: "/en/:path",
      },
    ];
  },
};

export default nextConfig;

