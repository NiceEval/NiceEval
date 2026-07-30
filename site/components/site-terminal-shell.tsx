"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RotateCcw } from "lucide-react";

// Hero 两套终端动画(人读 CLI / Claude Code 会话)共用的外壳与排版原语。
//
// 屏幕是定高视口,转录只增不减:内容超过视口后整段上移,旧行从上边缘裁掉,和真实终端
// 的 scrollback 一样。SSR、无 JavaScript 与 prefers-reduced-motion 走同一棵树的静态分支,
// 直接停在终帧——内容一个字不少,只是不淡入、不逐字打。
//
// 框线原语复刻 CLI 自己的区域框(src/report/model/panel.ts):`╭─ 标题 ── meta ─╮`、
// `│ 正文 │`、`├─ 小节 ─┤`、`╰── footer ─╯`。横线段用 flex 撑开后裁切,不按字符数补齐——
// 浏览器里 ● ✓ ✗ 这些字形的步进宽度未必等于等宽字体的一格,靠数字符会让右边框错位。

const AnimatedContext = createContext(false);

/** 转录里的一行/一段:动画分支淡入,静态分支就是普通节点。 */
export function Appear({ children, className }: { children: ReactNode; className?: string }) {
  const animated = useContext(AnimatedContext);
  const cls = animated ? (className ? `${className} appear` : "appear") : className;
  return <div className={cls}>{children}</div>;
}

export function Line({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={className ? `term-line ${className}` : "term-line"}>{children}</div>;
}

/** 逐字打的命令行。静态分支直接给整行。 */
export function Typed({ text, msPerChar, start, now }: { text: string; msPerChar: number; start: number; now: number }) {
  const animated = useContext(AnimatedContext);
  if (!animated) return <>{text}</>;
  const chars = Math.max(0, Math.floor((now - start) / msPerChar));
  return <>{text.slice(0, chars)}</>;
}

export function Cursor() {
  return <span className="term-cursor" />;
}

/** 横线填充段:flex 撑满剩余宽度后裁切,右侧嵌字因此总落在框的右边缘。 */
function Fill() {
  return <span className="pnl-fill">{"─".repeat(240)}</span>;
}

export function Panel({
  title,
  titleTone,
  meta,
  footer,
  children,
}: {
  title?: string;
  titleTone?: "pass" | "fail";
  meta?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div className="pnl">
      <div className="pnl-edge">
        <span>╭{title ? "─ " : ""}</span>
        {title ? <span className={titleTone ?? "pnl-title"}>{title}</span> : null}
        <span>{title ? " " : ""}</span>
        <Fill />
        {meta ? <span className="pnl-meta">{` ${meta} `}</span> : null}
        <span>╮</span>
      </div>
      {children}
      <div className="pnl-edge">
        <span>╰</span>
        <Fill />
        {footer ? <span className="pnl-meta">{` ${footer} `}</span> : null}
        <span>╯</span>
      </div>
    </div>
  );
}

export function PanelRow({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className="pnl-row">
      <span className="pnl-bar">│ </span>
      <div className={className ? `pnl-body ${className}` : "pnl-body"}>{children}</div>
      <span className="pnl-bar"> │</span>
    </div>
  );
}

export function PanelDivider({ title }: { title: string }) {
  return (
    <div className="pnl-edge">
      <span>├─ </span>
      <span className="pnl-section">{title}</span>
      <span> </span>
      <Fill />
      <span>┤</span>
    </div>
  );
}

/** rAF 驱动的时间轴:静态分支恒停在终帧,挂载后自动播一遍,replay 重新计时。 */
export function useTimeline(end: number, enabled: boolean) {
  const [now, setNow] = useState(end);
  const rafRef = useRef(0);
  const play = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const tick = (ts: number) => {
      const t = ts - t0;
      setNow(Math.min(t, end));
      if (t < end) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [end]);
  useEffect(() => {
    if (enabled) play();
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, play]);
  return { now, play };
}

/** 首帧(SSR 与 hydration)一律静态终帧;挂载后确认没开 reduced-motion 才切到动画分支。 */
export function useAnimated() {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    setAnimated(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return animated;
}

/**
 * 终端窗口:标题栏 + 定高屏幕。转录挂在屏幕里的一层 flow 上,内容比视口高时整体上移,
 * 露出最新的一屏——这一步必须量测,按字符数或 CSS 都算不出「转录现在有多高」。
 */
export function TerminalWindow({
  label,
  animated,
  onReplay,
  replayLabel,
  ariaLabel,
  children,
}: {
  label: string;
  animated: boolean;
  onReplay: () => void;
  replayLabel: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    const flow = flowRef.current;
    if (!screen || !flow) return undefined;
    const measure = () => {
      const style = getComputedStyle(screen);
      const room = screen.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setShift(Math.min(0, room - flow.scrollHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    observer.observe(screen);
    return () => observer.disconnect();
  }, []);

  return (
    <AnimatedContext.Provider value={animated}>
      <div className="term" aria-label={ariaLabel}>
        <div className="term-window">
          <div className="terminal-head">
            <span>{label}</span>
            <button type="button" className="term-replay" aria-label={replayLabel} onClick={onReplay}>
              <RotateCcw size={13} />
            </button>
          </div>
          {/* 转录还没顶到屏幕高度时不画上边缘的渐隐:那时没有被裁掉的 scrollback,压暗第一行只是噪声。 */}
          <div className={shift < 0 ? "term-screen scrolled" : "term-screen"} ref={screenRef}>
            <div className="term-flow" ref={flowRef} style={{ transform: `translateY(${shift}px)` }}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </AnimatedContext.Provider>
  );
}
