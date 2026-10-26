"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { MOCK_ACTIVITY, ACTIVITY_BADGE } from "@/lib/mock";

export default function ActivityPage() {
  const [read, setRead] = useState(() => new Set());

  const markRead = (i) =>
    setRead((prev) => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });

  return (
    <>
      <PageHeader
        eyebrow="Activity feed"
        title="Notifications"
        subtitle="Real email sending is MOCKED — add a Resend/SendGrid key to activate."
      />

      <Card className="divide-y divide-line">
        {MOCK_ACTIVITY.map((entry, i) => {
          const isRead = read.has(i);
          return (
            <div key={i} className={cn("flex items-start gap-3 px-4 py-3.5 sm:px-5", isRead && "opacity-60")}>
              <Badge className={ACTIVITY_BADGE[entry.type]}>{entry.type}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{entry.text}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {entry.time}
                  {entry.paper && (
                    <>
                      {" · "}
                      <Link href={`/papers/${encodeURIComponent(entry.paper)}`} className="font-semibold text-brand hover:underline">
                        view paper
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => markRead(i)}
                disabled={isRead}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted hover:text-ink disabled:opacity-50"
              >
                <Icon name="checks" size={16} /> <span className="hidden sm:inline">{isRead ? "Read" : "Mark read"}</span>
              </button>
            </div>
          );
        })}
      </Card>
    </>
  );
}
