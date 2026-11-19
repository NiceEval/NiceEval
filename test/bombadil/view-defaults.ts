// 跨进程保证：运行环境——真实浏览器执行 View 的脚本并报告异常与控制台错误
import { eventually } from "@antithesishq/bombadil";
import { ActionGenerator, branch, leaf } from "@antithesishq/bombadil/actions";
import { defaultActions } from "@antithesishq/bombadil/browser/defaults";
import { extract, type ActionTemplate } from "@antithesishq/bombadil/browser";

export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults";

const ready = extract(({ document }) => document.querySelector("main.niceeval-view-main:not([role=alert])") !== null);

const wait = leaf<ActionTemplate>("Wait");
// The View exchanges a one-time credential on its bootstrap page.
export const exploreView = new ActionGenerator(() =>
  ready.current === true
    ? branch([
        [1, wait],
        [9, defaultActions.generate()],
      ])
    : wait,
);

// @feature docs/feature/insight/README.md#first-party-review
export const viewRendersItsReviewSurface = eventually(() => ready.current === true).within(5, "seconds");
