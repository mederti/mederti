import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function truncateDrugName(name: string, maxLength = 80): string {
  if (!name || name.length <= maxLength) return name;
  return name.slice(0, maxLength - 3).trim() + "...";
}
