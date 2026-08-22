import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();
  const requestHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host)
    .split(",", 1)[0]
    .trim()
    .split(":", 1)[0]
    .toLowerCase();
  let shouldRedirect = false;

  // Vercel 的 host 条件 redirect 仍保留为第一层；这里同时做应用层兜底，避免域名
  // assignment / edge 配置漂移时 www 又以 200 提供整站，产生重复 canonical。
  if (requestHost === "www.niceeval.com") {
    url.hostname = "niceeval.com";
    url.protocol = "https:";
    url.port = "";
    shouldRedirect = true;
  }

  // 旧英文 URL 永久去前缀,308 到无前缀正式地址。
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    url.pathname = pathname.slice("/en".length) || "/";
    shouldRedirect = true;
  }

  if (shouldRedirect) return NextResponse.redirect(url, 308);
}

export const config = {
  // www 兜底必须覆盖页面、robots、sitemap 及外部 rewrite；只跳过没有独立
  // canonical 意义、且数量很大的 Next 内部资源。
  matcher: ["/((?!_next/static|_next/image).*)"],
};
