"use client";

import Icon from "@/components/ui/Icon";
import RoleSwitcher from "@/components/layout/RoleSwitcher";
import { AtlasCube } from "@/components/layout/BrandLogo";

/**
 * Header — top bar. On mobile it shows the menu button + compact brand;
 * on all sizes it shows the role switcher on the right.
 */
export default function Header({ onOpenMenu }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="rounded-lg p-2 text-ink hover:bg-soft lg:hidden"
        >
          <Icon name="menu" size={22} />
        </button>
        <span className="flex items-center gap-2 lg:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand p-0.5">
            <AtlasCube size={22} />
          </span>
          <span className="text-sm font-bold text-ink">2025–26 Portal</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <RoleSwitcher />
      </div>
    </header>
  );
}
