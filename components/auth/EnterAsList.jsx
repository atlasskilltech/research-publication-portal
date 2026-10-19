"use client";

import { useRouter } from "next/navigation";
import { ROLE_ORDER, ROLES } from "@/lib/constants";
import { MOCK_USERS } from "@/lib/mock";

/**
 * EnterAsList — the login "Enter as" quick-access panel (demo only).
 * Sets the viewed-as role in localStorage, then opens the dashboard.
 */
export default function EnterAsList() {
  const router = useRouter();

  const enter = (key) => {
    try {
      localStorage.setItem("rpp.role", key);
    } catch {
      /* ignore */
    }
    router.push("/dashboard");
  };

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Enter as</p>
      <ul className="flex flex-col gap-2">
        {ROLE_ORDER.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => enter(key)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left text-sm hover:bg-soft"
            >
              <span className="font-semibold text-ink">{ROLES[key].label}</span>
              <span className="truncate font-mono text-xs text-muted">{MOCK_USERS[key].email}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
