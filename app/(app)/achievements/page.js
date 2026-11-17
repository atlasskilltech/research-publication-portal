"use client";

import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import AchievementList from "@/components/achievements/AchievementList";
import { useRole } from "@/components/layout/RoleContext";

export default function MyAchievementsPage() {
  const { realRole } = useRole();
  return (
    <>
      <PageHeader
        eyebrow="Faculty achievements"
        title="My achievements"
        subtitle="Papers, books, patents, awards, reviewer and board roles, events, fellowships, consultancy and grants, each with proof attached. Entries that name you (for example on a patent) appear here too."
        action={
          <div className="flex flex-wrap gap-2">
            {realRole === "administrator" && <Button href="/achievements/all" variant="outline">All achievements</Button>}
            <Button href="/achievements/new"><Icon name="plus" size={16} /> Add achievement</Button>
          </div>
        }
      />
      <AchievementList />
    </>
  );
}
