"use client";

import { cn } from "@/lib/cn";

/**
 * Tabs — simple accessible tab bar (controlled).
 * tabs = [{ key, label }]
 */
export default function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto scroll-thin border-b border-line", className)} role="tablist">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
              isActive ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
