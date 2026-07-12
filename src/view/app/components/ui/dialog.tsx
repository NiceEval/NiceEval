import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn.ts";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

/**
 * Radix Dialog 内容容器:接管 portal / 焦点陷阱 / Esc 关闭 / 背景滚动锁 / 点遮罩关闭 ——
 * 这些原本在 AttemptModal 里手搓(keydown + documentElement.overflow + stopPropagation),现在交给 Radix。
 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/90" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[200] flex max-h-[min(86vh,820px)] w-[min(1120px,calc(100vw-48px))]",
          "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-strong",
          "bg-panel shadow-[0_20px_60px_rgba(0,0,0,0.45)] focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
