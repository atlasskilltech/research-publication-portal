"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ROLES } from "@/lib/constants";
import { MOCK_USERS } from "@/lib/mock";

const RoleContext = createContext(null);
const STORAGE_KEY = "rpp.role";

/**
 * RoleProvider — Phase-1 only. Holds the currently "viewed as" role so the
 * whole shell (nav + content) reacts to the role switcher. No real auth:
 * this stands in for a session until Phase 3.
 */
export function RoleProvider({ initialRole = "administrator", children }) {
  const [roleKey, setRoleKey] = useState(initialRole);

  // hydrate from localStorage (client-only; wrapped in try/catch for private mode)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && ROLES[saved]) setRoleKey(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setRole = (key) => {
    if (!ROLES[key]) return;
    setRoleKey(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({
      roleKey,
      role: ROLES[roleKey],
      user: MOCK_USERS[roleKey],
      setRole,
    }),
    [roleKey],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
