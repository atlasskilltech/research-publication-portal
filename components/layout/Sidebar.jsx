"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import Icon from "@/components/ui/Icon";
import BrandLogo from "@/components/layout/BrandLogo";
import { navForRole } from "@/lib/constants";
import { useRole } from "@/components/layout/RoleContext";

function NavLinks({ onNavigate }) {
  const pathname = usePathname();
  const { roleKey, roles } = useRole();
  const items = [...navForRole(roleKey)];

  // Capability-aware: a user who holds a reviewer role (but isn't an admin, who
  // reviews via Submissions) gets a "My Reviews" entry regardless of their
  // cosmetic base role.
  const isReviewer = (roles || []).some((r) => r === "PEER_REVIEWER" || r === "DESK_REVIEWER");
  if (isReviewer && roleKey !== "administrator" && !items.some((i) => i.href === "/reviews")) {
    items.push({ label: "My Reviews", href: "/reviews", icon: "checks" });
  }
  // Holders of the EDITOR role get the editorial dashboard (the API scopes it
  // to papers they're assigned to edit). Admins already have it in their nav.
  if ((roles || []).includes("EDITOR") && roleKey !== "administrator" && !items.some((i) => i.href === "/editorial")) {
    items.push({ label: "Editorial", href: "/editorial", icon: "volumes" });
  }
  // …and the publication dashboard (scoped server-side to papers they edit).
  if ((roles || []).includes("EDITOR") && roleKey !== "administrator" && !items.some((i) => i.href === "/publications/manage")) {
    items.push({ label: "Publications", href: "/publications/manage", icon: "papers" });
  }

  // Highlight only the most specific match (so /publications/manage doesn't
  // also light up "Published" at /publications).
  const matches = (href) => pathname === href || pathname.startsWith(href + "/");
  const activeHref = items.map((i) => i.href).filter(matches).sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-brand text-white" : "text-ink hover:bg-soft",
            )}
          >
            <Icon name={item.icon} size={20} className={active ? "text-white" : "text-muted"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserCard() {
  const { user, role } = useRole();
  return (
    <div className="mx-3 mb-3 rounded-xl border border-line bg-soft/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Signed in as</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink">{user.name}</p>
      <p className="truncate text-xs text-muted">{user.email}</p>
      <span className={cn("mt-2 inline-flex rounded px-2 py-0.5 text-[10px] font-bold", role.chip)}>
        {role.chipText}
      </span>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/logout", { method: "POST" });
          window.location.href = "/login"; // full reload clears client state
        }}
        className="mt-3 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-semibold text-muted hover:text-ink"
      >
        <Icon name="logout" size={18} /> Sign out
      </button>
    </div>
  );
}

function SidebarInner({ onNavigate }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <BrandLogo />
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-2">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <UserCard />
    </div>
  );
}

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {/* Desktop: static rail */}
      <aside className="hidden w-64 shrink-0 border-r border-line bg-white lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarInner />
        </div>
      </aside>

      {/* Mobile/tablet: slide-over drawer */}
      <div className={cn("lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}>
        <div
          className={cn(
            "fixed inset-0 z-40 bg-ink/40 transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={onClose}
          aria-hidden="true"
        />
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-72 max-w-[82%] border-r border-line bg-white shadow-xl transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Sidebar"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <BrandLogo />
            <button type="button" onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 text-muted hover:bg-soft">
              <Icon name="close" size={22} />
            </button>
          </div>
          <div className="flex h-[calc(100%-56px)] flex-col">
            <div className="flex-1 overflow-y-auto scroll-thin py-2">
              <NavLinks onNavigate={onClose} />
            </div>
            <UserCard />
          </div>
        </aside>
      </div>
    </>
  );
}
