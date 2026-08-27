"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { track } from "../src/analytics";
import { loopFrames } from "../src/agent-loop";
import type { Dictionary, Locale } from "../lib/content";

// 环的几何:viewBox 400×400,四段带箭头的环形扇区绕圆心顺时针一圈,步骤标题
// 写在扇区中段。每段是一条闭合路径:外弧 → 箭头外肩 → 箭尖 → 箭头内肩 → 内弧,
// 填充 + 1px 描边,和站点卡片同一质感;段与段之间的空隙就是箭头指向的方向。
const RING_SIZE = 400;
const R_OUT = 184;
const R_IN = 124;
const R_MID = (R_OUT + R_IN) / 2;

function ringPoint(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: RING_SIZE / 2 + r * Math.sin(rad),
    y: RING_SIZE / 2 - r * Math.cos(rad),
  };
}

function pt(deg: number, r: number) {
  const { x, y } = ringPoint(deg, r);
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

// 每段扇区的弧体对称落在 12/3/6/9 点(-26°..+26°),箭头接在 +26° 这一端。
// 标签在 0° 正好是弧体中心,四个方向都不偏。
const FLARE = 8;
const HEAD_LEN = 60;
// 尾切口相对半径线偏 5°。纯半径切口对两条弧的切线各是精确 90°,但两条弧都朝圆心弯:
// 外角处弧往夹角里弯、看着是锐角(视觉约 85°),内角处弧朝外弯、看着是钝角(约 97°)。
// 偏 5° 把这个曲率偏置抵掉,两个角看起来才都是直角。
const TAIL_SHEAR = 5;

// 箭尖沿 to 处的切线直着探出去,而不是继续沿弧走:箭头底边是 to 的半径线,
// 本就垂直于切线,箭尖再顺着切线走才和底边构成等腰三角形。若把箭尖也放在弧上,
// 底边到箭尖的弦方向会偏离切线半个张角,箭头会看着是斜的。
function headTip(deg: number) {
  const rad = (deg * Math.PI) / 180;
  const base = ringPoint(deg, R_MID);
  return `${(base.x + HEAD_LEN * Math.cos(rad)).toFixed(1)} ${(base.y + HEAD_LEN * Math.sin(rad)).toFixed(1)}`;
}

// 尾部内角:从外角沿偏转后的方向往圆心走,交到 R_IN 圆上的那一点(解 |d - t·u| = R_IN 取近根)。
function tailInnerCorner(from: number) {
  const rad = ((from + TAIL_SHEAR) * Math.PI) / 180;
  const u = { x: Math.sin(rad), y: -Math.cos(rad) };
  const outer = ringPoint(from, R_OUT);
  const d = { x: outer.x - RING_SIZE / 2, y: outer.y - RING_SIZE / 2 };
  const b = d.x * u.x + d.y * u.y;
  const t = b - Math.sqrt(b * b - (d.x * d.x + d.y * d.y - R_IN * R_IN));
  return `${(outer.x - t * u.x).toFixed(1)} ${(outer.y - t * u.y).toFixed(1)}`;
}

function segmentPath(index: number) {
  const from = index * 90 - 26;
  const to = index * 90 + 26;
  return [
    `M ${pt(from, R_OUT)}`,
    `A ${R_OUT} ${R_OUT} 0 0 1 ${pt(to, R_OUT)}`,
    `L ${pt(to, R_OUT + FLARE)}`,
    `L ${headTip(to)}`,
    `L ${pt(to, R_IN - FLARE)}`,
    `L ${pt(to, R_IN)}`,
    `A ${R_IN} ${R_IN} 0 0 0 ${tailInnerCorner(from)}`,
    "Z",
  ].join(" ");
}

// 「Agent 也是用户」区块：左侧是四段弧带箭头组成的循环图（评估→诊断→定位→优化），
// 右侧终端按当前步骤展示对应输出。环进入视口后才推进，悬停暂停，点击只把倒计时清零。
// 这里的自动推进直接解释循环顺序，不承担装饰作用。
export default function AgentLoop({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [activeStep, setActiveStep] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hovering || !inView) return undefined;
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % loopFrames.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [hovering, inView, resetKey]);

  const activate = (index: number) => {
    setResetKey((key) => key + 1);
    if (index === activeStep) return;
    track("Switch Agent Loop Step", { step: loopFrames[index].id, locale });
    setActiveStep(index);
  };

  const frame = loopFrames[activeStep];

  return (
    <section
      id="agent-loop"
      className="loop shell"
      ref={sectionRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="loop-intro">
        <p className="eyebrow">{t.loopEyebrow}</p>
        <h2>{t.loopTitle}</h2>
        <p className="setup-caption">{t.loopCaption}</p>
        {/* 四段带箭头的扇区排成顺时针的环,标题写在扇区里,整段扇区就是切换按钮。
            环本身就是这段叙事——fix 的箭头指回 run,当前步骤的扇区点绿。 */}
        <div className="loop-ring" role="tablist" aria-label={t.loopEyebrow}>
          <svg className="loop-ring-svg" viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            {t.loopSteps.map(([label, cmd], index) => {
              const mid = ringPoint(index * 90, R_MID);
              return (
                <g
                  key={label}
                  role="tab"
                  tabIndex={0}
                  aria-selected={index === activeStep}
                  className={index === activeStep ? "loop-arc-group active" : "loop-arc-group"}
                  onClick={() => activate(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activate(index);
                    }
                  }}
                >
                  <path className="loop-arc" d={segmentPath(index)} vectorEffect="non-scaling-stroke" />
                  <text className="loop-arc-label" x={mid.x} y={mid.y - 7} textAnchor="middle" dominantBaseline="central">
                    {label}
                  </text>
                  <text className="loop-arc-cmd" x={mid.x} y={mid.y + 11} textAnchor="middle" dominantBaseline="central">
                    {cmd}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="terminal" role="tabpanel">
        <div className="terminal-head">
          <Terminal size={13} />
          <span>{t.loopTerminalLabel}</span>
          <code>{frame.lines[0].text.slice(2)}</code>
        </div>
        <pre className="terminal-body">
          {frame.lines.map((row, index) => (
            <span key={index} className={`term-line term-${row.kind}`}>
              {row.text}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
    </section>
  );
}
