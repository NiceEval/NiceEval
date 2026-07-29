import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn / Magic UI 复制粘贴组件约定的 class 合并入口:后写的 utility 覆盖组件默认值。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
