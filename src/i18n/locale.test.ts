// cases: docs/engineering/testing/unit/experiments-runner.md
// 界面语言的取值链(「界面语言的取值链」类别):config.locale → 系统 locale
// (LC_ALL → LC_MESSAGES → LANG)→ zh-CN。语言是配置,家在 defineConfig({ locale });
// 系统 locale 只是「输出到哪个终端」的环境事实,niceeval 不再自备 NICEEVAL_LANG /
// NICEEVAL_LOCALE 这类配置变量(边界见 docs/architecture.md「配置从代码来,凭据从环境来」)。

import { afterEach, describe, expect, it } from "vitest";
import { detectLocale, setConfiguredLocale } from "./index.ts";

afterEach(() => {
  setConfiguredLocale(undefined);
});

describe("界面语言的取值链", () => {
  // 系统环境全是中文,config 说 en —— 取 en。反过来的错误实现(环境优先)会给出 zh-CN。
  it("config.locale 压过系统 locale", () => {
    setConfiguredLocale("en");
    expect(detectLocale({ LC_ALL: "zh_CN.UTF-8", LANG: "zh_CN.UTF-8" })).toBe("en");
  });

  it("config.locale 未声明时按 LC_ALL → LC_MESSAGES → LANG 逐级回落", () => {
    expect(detectLocale({ LC_ALL: "en_US.UTF-8", LC_MESSAGES: "zh_CN.UTF-8", LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(detectLocale({ LC_MESSAGES: "en_US.UTF-8", LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(detectLocale({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(detectLocale({})).toBe("zh-CN");
  });

  // C / POSIX 是「未指定语言」,不是一种语言:该跳过它去看下一个候选,而不是当成非中文落 en。
  it("无法归一的值按未声明处理,继续往下找", () => {
    expect(detectLocale({ LC_ALL: "C", LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    setConfiguredLocale("POSIX");
    expect(detectLocale({ LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
  });

  // 旧的 niceeval 专有变量已经不是取值链的一环:摆在环境里也不该改变结果。
  it("NICEEVAL_LANG / NICEEVAL_LOCALE 不参与判定", () => {
    expect(detectLocale({ NICEEVAL_LANG: "en", NICEEVAL_LOCALE: "en", LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    setConfiguredLocale("en");
    expect(detectLocale({ NICEEVAL_LANG: "zh-CN" })).toBe("en");
  });
});
