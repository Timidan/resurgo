import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Install page of the "Resurgo Agent" GitHub App. */
export const INSTALL_URL = "https://github.com/apps/resurgo-agent/installations/new";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
