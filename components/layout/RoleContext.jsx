"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ROLES } from "@/lib/constants";
import { MOCK_USERS } from "@/lib/mock";

const RoleContext = createContext(null);
const STORAGE_KEY = "rpp.role";

/** Map the authenticated session to a starting role key. */
function roleFromSession(sessionUser) {
  if (!sessionUser) return "student";
  if (sessionUser.isAdmin) return "administrator";
  return sessionUser.baseType === "FACULTY" ? "faculty" : "student";
}

/**
 * RoleProvider — holds the "viewed as" role for the shell.
 *
 * Identity and the real role come from the server session (never localStorage).
 * Only a real Administrator may switch the viewed context (a cosmetic preview);
 * the server still authorizes every protected action independently, so the
 * client-side role can never grant access.
 */
export function RoleProvider({ sessionUser = null, children }) {
  const realRole = roleFromSession(sessionUser);
  const canSwitch = !!sessionUser?.isAdmin;

  const [roleKey, setRoleKey] = useState(realRole);

  // Admins may restore a previously-previewed role; non-admins are pinned to
  // their real role and localStorage is ignored for them.
  useEffect(() => {
    if (!canSwitch) {
      setRoleKey(realRole);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && ROLES[saved]) setRoleKey(saved);
    } catch {
      /* ignore */
    }
  }, [canSwitch, realRole]);

  const setRole = useCallback(
    (key) => {
      if (!canSwitch || !ROLES[key]) return; // non-admins cannot change context
      setRoleKey(key);
      try {
        localStorage.setItem(STORAGE_KEY, key);
      } catch {
        /* ignore */
      }
    },
    [canSwitch],
  );

  const user = useMemo(
    () =>
      sessionUser
        ? { name: sessionUser.name, email: sessionUser.email, role: realRole }
        : MOCK_USERS.student,
    [sessionUser, realRole],
  );

  const value = useMemo(
    () => ({
      roleKey,
      role: ROLES[roleKey] || ROLES.student,
      user,
      realRole,
      canSwitch,
      setRole,
    }),
    [roleKey, canSwitch, realRole, user, setRole],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
