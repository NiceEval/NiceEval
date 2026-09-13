import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "X", description: "你的时间线" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
