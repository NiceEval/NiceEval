import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * 状态小标签:边框 + 浅底都取自当前文字色,tone(.good/.bad/.warn/.infra-err)决定颜色。
 * 取代旧的 .modal-verdict / 内联状态 chip。
 */
export function Badge({ tone, className, children }: { tone?: string; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block w-fit rounded-[5px] border border-current bg-current/10 px-[7px] py-px",
        "text-[10px] font-bold uppercase tracking-[0.05em]",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
