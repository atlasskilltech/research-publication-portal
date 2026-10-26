"use client";

import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { RoleProvider } from "@/components/layout/RoleContext";

/**
 * AppShell — the authenticated layout frame: role-aware sidebar + header
 * around the page content. Manages the mobile drawer state and provides
 * the (Phase-1) role context.
 */
export default function AppShell({ children, sessionUser }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <RoleProvider sessionUser={sessionUser}>
      <div className="flex min-h-screen bg-canvas">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMenu={() => setMenuOpen(true)} />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </RoleProvider>
  );
}
