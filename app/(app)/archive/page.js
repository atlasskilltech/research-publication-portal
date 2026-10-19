"use client";

import RoleGuard from "@/components/layout/RoleGuard";
import ArchiveList from "@/components/manage/ArchiveList";

export default function ArchivePage() {
  return (
    <RoleGuard allow={["administrator", "editor"]} section="Archive">
      <ArchiveList />
    </RoleGuard>
  );
}
