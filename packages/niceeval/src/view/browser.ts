import { spawn } from "node:child_process";
import { Context, Data, Effect, Layer } from "effect";

export class ViewBrowserError extends Data.TaggedError("ViewBrowserError")<{
  readonly operation: "open-browser";
  readonly cause: unknown;
}> {}

export interface ViewBrowserService {
  readonly open: (url: string) => Effect.Effect<boolean, ViewBrowserError>;
}

export class ViewBrowser extends Context.Service<ViewBrowser, ViewBrowserService>()("@niceeval/view/ViewBrowser") {}

function browserCommand(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "cmd";
    default:
      return "xdg-open";
  }
}

export const NodeViewBrowserLive = Layer.succeed(ViewBrowser, {
  open: (url) =>
    Effect.callback<boolean, ViewBrowserError>((resume) => {
      const command = browserCommand();
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      let settled = false;
      const finish = (opened: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resume(Effect.succeed(opened));
      };
      let child;
      try {
        child = spawn(command, args, { detached: true, stdio: "ignore" });
      } catch (cause) {
        resume(Effect.fail(new ViewBrowserError({ operation: "open-browser", cause })));
        return Effect.void;
      }
      const timer = setTimeout(() => finish(true), 1_500);
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      child.unref();
      return Effect.sync(() => clearTimeout(timer));
    }),
});
