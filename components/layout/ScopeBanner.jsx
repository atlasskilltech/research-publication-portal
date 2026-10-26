"use client";

import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { useRole } from "@/components/layout/RoleContext";
import { SCOPE_BANNER } from "@/lib/mock";

/**
 * ScopeBanner — the "Showing only papers assigned to you as …" notice.
 * Renders only for scoped roles (SPOC, Desk, Peer, Editor).
 */
export default function ScopeBanner() {
  const { roleKey, role } = useRole();
  const text = SCOPE_BANNER[roleKey];
  if (!text) return null;

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <span className={cn("mt-0.5 rounded px-2 py-0.5 text-[10px] font-bold", role.chip)}>{role.chipText}</span>
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}
