import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const englishPrefix = "/en";

  if (pathname === englishPrefix || pathname.startsWith(`${englishPrefix}/`)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(englishPrefix.length) || "/";
    return NextResponse.redirect(url, 308);
  }

  if (pathname === "/zh" || pathname.startsWith("/zh/")) return;

  // 英文正式 URL 不带语言前缀;沿用现有 /en 动态路由作为唯一渲染源,浏览器地址保持无前缀。
  const url = request.nextUrl.clone();
  url.pathname = `/en${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // 显式 /en/* 必须覆盖带扩展名的旧 URL;其余 matcher 只处理产品站页面。
  // docs、showcase 由外部 rewrites 接管,_next 与静态文件不进入英文 rewrite。
  matcher: [
    "/en",
    "/en/:path*",
    "/((?!_next|docs|showcase|.*\\..*).*)",
  ],
};
