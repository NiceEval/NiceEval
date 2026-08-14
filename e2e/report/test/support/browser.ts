import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { once } from "node:events";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(overflow.scrollWidth, `horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`).toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}

export async function followVisibleLink(page: Page, name: string | RegExp): Promise<string> {
  const link = page.getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href, `link ${String(name)} missing href`).toBeTruthy();
  const target = new URL(href!, page.url()).href;
  const response = await page.request.get(target);
  expect(response.status(), `GET ${target}`).toBe(200);
  await page.goto(target);
  return target;
}

export interface StaticSiteServer {
  readonly origin: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function requestedRelativePath(rawPathname: string): string | undefined {
  const raw = rawPathname === "/" ? "index.html" : rawPathname.replace(/^\/+/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (decoded.split(/[\\/]/).some((segment) => segment === "..")) return undefined;
  // Keep percent escapes in the filesystem name: exported parameterized routes
  // intentionally use literal `%2F` / `%40` filename segments.
  return raw;
}

/** Serves an already exported static report without rerunning `niceeval view`. */
export async function serveStaticSite(directory: string): Promise<StaticSiteServer> {
  const root = resolve(directory);
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://static-report.invalid").pathname;
    const relativePath = requestedRelativePath(pathname);
    if (relativePath === undefined) {
      response.writeHead(400).end("bad request path");
      return;
    }
    const file = resolve(root, relativePath);
    if (!isContained(root, file)) {
      response.writeHead(403).end("outside static report");
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("static report server did not receive a TCP address");
  }
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
