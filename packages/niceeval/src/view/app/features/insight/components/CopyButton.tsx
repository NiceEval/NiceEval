import { useState, type ReactNode } from "react";

export function CopyButton({ text, className, children }: {
  readonly text: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (copied) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    }
  };
  return <button type="button" className={className} onClick={() => void copy()}>{children}{copied ? " ✓" : ""}</button>;
}
