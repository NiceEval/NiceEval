import { networkInterfaces } from "node:os";
import { withSentryConfig } from "@sentry/nextjs/config";

if (process.env.VERCEL_ENV === "production" && !process.env.SENTRY_AUTH_TOKEN) {
  throw new Error("Production deployment requires SENTRY_AUTH_TOKEN for sourcemap upload");
}

const localDevOrigins = [
  "127.0.0.1",
  ...Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? []).filter(({ family, internal }) => family === "IPv4" && !internal).map(({ address }) => address),
  ),
];

const release =
  process.env.SENTRY_RELEASE || (process.env.VERCEL_GIT_COMMIT_SHA ? `site@${process.env.VERCEL_GIT_COMMIT_SHA}` : "");
const environment = process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "production";
/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@sentry/profiling-node", "@sentry/node-cpu-profiler"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sentry/profiling-node/**/*",
      "../../node_modules/.pnpm/@sentry+node-cpu-profiler@*/node_modules/@sentry/node-cpu-profiler/lib/**/*",
    ],
  },
  env: {
    SENTRY_RELEASE: release,
    NEXT_PUBLIC_SENTRY_RELEASE: release,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: environment,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || "",
  },
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Document-Policy", value: "js-profiling" }] }];
  },
  // dev server 监听 0.0.0.0 时，浏览器实际使用回环或网卡 IP；只放行本机
  // 拥有的地址，避免 Next 把 hydration / HMR chunk 当成跨站请求拦成 403。
  allowedDevOrigins: [...new Set(localDevOrigins)],
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

export default withSentryConfig(nextConfig, {
  org: "instaai",
  project: "niceeval-landing",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
  release: { name: release, create: !!process.env.SENTRY_AUTH_TOKEN },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
});
