// NiceEval 的 mark:"graded transcript"——三根递减的对话横条,右下角一记判定对勾。
// 横条走 currentColor 跟随上下文文本色,对勾用主题的 positive(--good):它标的是"通过"。
export function LogoMark({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <rect x="6" y="9" width="52" height="9" fill="currentColor" />
      <rect x="6" y="26" width="30" height="9" fill="currentColor" />
      <rect x="6" y="43" width="16" height="9" fill="currentColor" />
      <polyline
        points="33 43, 42 52, 57 29"
        stroke="var(--good, #3ddc97)"
        strokeWidth="9"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
