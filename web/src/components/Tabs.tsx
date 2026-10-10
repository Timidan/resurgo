import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * A tablist with roving tabindex and arrow-key, Home and End support.
 * The caller renders the panel with `id={panelId(prefix, value)}` and `aria-labelledby={tabId(prefix, value)}`.
 */
export function TabList<T extends string>({
  prefix,
  label,
  tabs,
  value,
  onChange,
  orientation = "horizontal",
  className,
  tabClassName,
  render,
}: {
  prefix: string;
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T, byUser: boolean) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
  tabClassName: (selected: boolean) => string;
  render?: (tab: { id: T; label: string }, selected: boolean) => ReactNode;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: KeyboardEvent, i: number) => {
    const next = orientation === "vertical" ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    let j = i;
    if (e.key === next[0]) j = (i + 1) % tabs.length;
    else if (e.key === next[1]) j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[j].id, true);
    refs.current[tabs[j].id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className={className}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => void (refs.current[t.id] = el)}
            type="button"
            role="tab"
            id={tabId(prefix, t.id)}
            aria-selected={selected}
            aria-controls={panelId(prefix, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id, true)}
            onKeyDown={(e) => move(e, i)}
            className={cn(tabClassName(selected))}
          >
            {render ? render(t, selected) : t.label}
          </button>
        );
      })}
    </div>
  );
}
