// owner: docs/engineering/testing/e2e/report.md#loopback-authorization
// rerun: pnpm e2e test --repo report -- --run test/view-authorization.browser.spec.ts

import { only, pollUntil } from "@niceeval/testkit";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Request,
  type Response,
} from "@playwright/test";
import {
  expectLoopbackReadyUrl,
  reportCaseArtifacts,
  reportE2E,
  waitForViewReady,
} from "./support.ts";

test("loopback view 只向一次性 fragment 换取的同源 session 交付 facts", async ({ browser }) => {
  await reportE2E.case(
    "view-loopback-authorization",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const runId = only(produced.expReceipt().runIds, () => true, produced.diagnostic());
      const attempt = only(
        produced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        produced.diagnostic(),
      );
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      const context = await browser.newContext();
      const page = await context.newPage();
      const api = await playwrightRequest.newContext();
      const responses: Response[] = [];
      page.on("response", (response) => responses.push(response));
      try {
        const ready = await waitForViewReady(view);
        const readyUrl = expectLoopbackReadyUrl(ready.url);
        const credential = readyUrl.hash.slice(1);
        expect(readyUrl.search).not.toContain(credential);

        await page.goto(readyUrl.href);
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
        const runLink = page.getByRole("link", { name: runId, exact: true }).first();
        const overviewUrl = page.url();
        const runHref = await runLink.getAttribute("href");
        expect(runHref).not.toBeNull();
        await runLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(runHref!, overviewUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Run\\s+${runId}$`) })).toBeVisible();

        const attemptLink = page.getByRole("link", { name: locator, exact: true }).first();
        const runUrl = page.url();
        const attemptHref = await attemptLink.getAttribute("href");
        expect(attemptHref).not.toBeNull();
        await attemptLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(attemptHref!, runUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Attempt\\s+${locator}$`) })).toBeVisible();
        expect(page.url()).not.toContain(readyUrl.hash);
        expect(responses.every((response) => !response.url().includes(credential))).toBe(true);

        const sessionResponse = await pollUntil(
          async () => {
            for (const response of responses) {
              if (response.status() < 200 || response.status() >= 300) continue;
              if (new URL(response.url()).origin !== readyUrl.origin) continue;
              const request = response.request();
              if (!["fetch", "xhr"].includes(request.resourceType())) continue;
              const headers = await request.allHeaders();
              if (typeof headers.cookie === "string" && headers.cookie.length > 0) return response;
            }
            return undefined;
          },
          { timeoutMs: 10_000, intervalMs: 50, label: "authenticated view data request" },
        );
        expect(sessionResponse.headers()["cache-control"]).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/i);

        const cookies = await context.cookies(readyUrl.origin);
        expect(cookies.length).toBeGreaterThan(0);
        expect(cookies.every((cookie) => cookie.httpOnly)).toBe(true);
        expect(cookies.every((cookie) => cookie.sameSite === "Strict")).toBe(true);
        expect(cookies.every((cookie) => !cookie.domain.startsWith("."))).toBe(true);
        const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");

        const accepted = await replaySessionRequest(api, sessionResponse.request(), {
          cookie: cookieHeader,
          host: readyUrl.host,
          origin: readyUrl.origin,
        });
        expect(accepted.status(), await accepted.text()).toBe(sessionResponse.status());
        expect(accepted.headers()["cache-control"]).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/i);

        for (const rejected of [
          await replaySessionRequest(api, sessionResponse.request(), {
            host: readyUrl.host,
            origin: readyUrl.origin,
          }),
          await replaySessionRequest(api, sessionResponse.request(), {
            cookie: cookieHeader,
            host: readyUrl.host,
            origin: "https://cross-site.invalid",
          }),
          await replaySessionRequest(api, sessionResponse.request(), {
            cookie: cookieHeader,
            host: `localhost:${readyUrl.port}`,
            origin: readyUrl.origin,
          }),
        ]) {
          expect([400, 401, 403]).toContain(rejected.status());
          expect(rejected.headers()["cache-control"]).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/i);
        }

        const replayContext = await browser.newContext();
        try {
          const replayPage = await replayContext.newPage();
          const rejectedStatuses: number[] = [];
          replayPage.on("response", (response) => {
            if ([400, 401, 403].includes(response.status())) rejectedStatuses.push(response.status());
          });
          await replayPage.goto(readyUrl.href);
          await expect.poll(() => rejectedStatuses.length, { timeout: 5_000 }).toBeGreaterThan(0);
          await expect(replayPage.getByText(runId, { exact: false })).toHaveCount(0);
        } finally {
          await replayContext.close();
        }
      } finally {
        await api.dispose();
        await context.close();
        if (!view.settledExit) view.signal("SIGTERM");
        await view.dispose();
      }
    },
  );
});

async function replaySessionRequest(
  api: APIRequestContext,
  request: Request,
  authority: { readonly cookie?: string; readonly host: string; readonly origin: string },
): Promise<APIResponse> {
  const observed = await request.allHeaders();
  const headers: Record<string, string> = {
    accept: observed.accept ?? "application/json",
    host: authority.host,
    origin: authority.origin,
  };
  if (authority.cookie !== undefined) headers.cookie = authority.cookie;
  if (observed["content-type"] !== undefined) headers["content-type"] = observed["content-type"];
  for (const [name, value] of Object.entries(observed)) {
    if (name.startsWith("x-niceeval-")) headers[name] = value;
  }
  return await api.fetch(request.url(), {
    method: request.method(),
    headers,
    data: request.postDataBuffer() ?? undefined,
    failOnStatusCode: false,
  });
}
