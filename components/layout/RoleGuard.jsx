"use client";

import { useRole } from "@/components/layout/RoleContext";
import { ROLES } from "@/lib/constants";
import Icon from "@/components/ui/Icon";
import Button from "@/components/ui/Button";

/**
 * RoleGuard — Phase-3 demo gate for whole sections (Import/Volumes/Archive/Users).
 * Renders children only when the active mock role is in `allow`; otherwise shows a
 * generic "not available for this role" card. Server-enforced for real in a later phase.
 *
 *   <RoleGuard allow={["administrator", "editor"]}> … </RoleGuard>
 */
export default function RoleGuard({ allow = [], section = "This section", children }) {
  const { roleKey } = useRole();
  if (allow.includes(roleKey)) return children;

  const allowed = allow.map((k) => ROLES[k]?.label || k).join(" or ");

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-white px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted">
        <Icon name="lock" size={26} />
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Not available for your role</p>
      <h1 className="mt-1 text-xl font-bold text-ink">{section} is restricted</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        This area is available to the <b>{allowed}</b>. Switch role with “Viewing as” above, or contact the Administrator if you believe you should have access.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button href="/dashboard" variant="primary">Back to dashboard</Button>
        <Button href="/dashboard" variant="outline">Go to dashboard</Button>
      </div>
    </div>
  );
}
