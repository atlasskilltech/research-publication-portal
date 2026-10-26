"use client";

import RoleGuard from "@/components/layout/RoleGuard";
import VolumesBoard from "@/components/manage/VolumesBoard";

export default function VolumesPage() {
  return (
    <RoleGuard allow={["administrator", "editor"]} section="Volumes">
      <VolumesBoard />
    </RoleGuard>
  );
}
