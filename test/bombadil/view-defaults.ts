// 跨进程保证：运行环境——真实浏览器执行 View 的脚本并报告异常与控制台错误
import { eventually } from "@antithesishq/bombadil";
import { ActionGenerator, branch, leaf } from "@antithesishq/bombadil/actions";
import { actions, extract, registerCustomAction, weighted, type ActionTemplate } from "@antithesishq/bombadil/browser";
import { clicks, inputs, reload, scroll, waitOnce } from "@antithesishq/bombadil/browser/defaults/actions";
import { traverseViewHistory } from "./browser-history.ts";

export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults";

const ready = extract(({ document }) => document.querySelector("main.niceeval-view-main:not([role=alert])") !== null);

const canTraverse = extract(({ window }) => ({
  back: window.navigation.canGoBack,
  forward: window.navigation.canGoForward,
}));

// The browser's raw history can move after a sample. Use the live same-origin history when applying an action.
const traverse = registerCustomAction("traverseViewHistory", (_document, window, direction: "back" | "forward") =>
  traverseViewHistory(window.navigation, direction),
);
const navigation = weighted([
  [10, actions(() => (canTraverse.current?.back ? [traverse("back")] : []))],
  [1, actions(() => (canTraverse.current?.forward ? [traverse("forward")] : []))],
  [1, reload],
]);
const viewActions = weighted([
  [100, clicks],
  [100, inputs],
  [50, scroll],
  [10, navigation],
  [1, waitOnce],
]);

const wait = leaf<ActionTemplate>("Wait");
// The View exchanges a one-time credential on its bootstrap page.
export const exploreView = new ActionGenerator(() =>
  ready.current === true
    ? branch([
        [1, wait],
        [9, viewActions.generate()],
      ])
    : wait,
);

// @feature docs/feature/insight/README.md#first-party-review
export const viewRendersItsReviewSurface = eventually(() => ready.current === true).within(5, "seconds");
