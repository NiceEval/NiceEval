import { spawn } from "node:child_process";
import { Context, Data, Effect, Layer } from "effect";

export class ViewBrowserError extends Data.TaggedError("ViewBrowserError")<{
  readonly operation: "open-browser";
  readonly cause: unknown;
}> {}

export interface ViewBrowserService {
  readonly open: (url: string) => Effect.Effect<void, ViewBrowserError>;
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
    Effect.callback<void, ViewBrowserError>((resume, signal) => {
      const command = browserCommand();
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      const fail = (cause: unknown): void => {
        if (!signal.aborted) resume(Effect.fail(new ViewBrowserError({ operation: "open-browser", cause })));
      };
      let child;
      try {
        child = spawn(command, args, { detached: true, stdio: "ignore" });
      } catch (cause) {
        fail(cause);
        return;
      }
      child.once("error", fail);
      child.once("exit", (code, exitSignal) => {
        if (code !== 0) {
          fail(new Error(`${command} exited with ${exitSignal ?? code}`));
          return;
        }
        if (!signal.aborted) resume(Effect.void);
      });
      child.unref();
    }),
});
