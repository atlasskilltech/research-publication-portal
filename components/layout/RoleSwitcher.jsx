"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import Icon from "@/components/ui/Icon";
import { ROLE_ORDER, ROLES } from "@/lib/constants";
import { useRole } from "@/components/layout/RoleContext";

/**
 * RoleSwitcher — "Viewing as [role ▾]" control (mirrors the reference
 * role switcher). Phase-1 demo of the multi-role model.
 */
export default function RoleSwitcher() {
  const { roleKey, role, setRole } = useRole();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-soft"
      >
        <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted sm:inline">Viewing as</span>
        <span className={cn("rounded px-2 py-0.5 text-[11px] font-bold", role.chip)}>{role.chipText}</span>
        <Icon name="chevron" size={16} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-lg"
        >
          <p className="border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Switch role
          </p>
          <ul className="max-h-80 overflow-y-auto scroll-thin py-1">
            {ROLE_ORDER.map((key) => {
              const r = ROLES[key];
              const active = key === roleKey;
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setRole(key);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-soft",
                      active && "bg-brand-50",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink">{r.label}</span>
                      <span className="block text-xs text-muted">{r.caption}</span>
                    </span>
                    {active && <Icon name="check" size={16} className="text-brand" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Roles come from the Administrator, per paper. You can&apos;t review a paper you submitted.
          </p>
        </div>
      )}
    </div>
  );
}
