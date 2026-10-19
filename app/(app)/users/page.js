"use client";

import RoleGuard from "@/components/layout/RoleGuard";
import UsersTable from "@/components/manage/UsersTable";

export default function UsersPage() {
  return (
    <RoleGuard allow={["administrator"]} section="People & roles">
      <UsersTable />
    </RoleGuard>
  );
}
