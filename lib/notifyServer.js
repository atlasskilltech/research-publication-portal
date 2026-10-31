import "server-only";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/config/env";
import { sendEmail } from "@/lib/email/send";
import { maskEmail } from "@/lib/email/core";
import { AUDIENCE, buildNotification, uniqueRecipients } from "@/lib/notifications";

const REVIEWER_ROLES = ["PEER_REVIEWER", "DESK_REVIEWER"];

async function emailsFor(admin, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return [];
  const { data } = await admin.from("profiles").select("id, email").in("id", list);
  return data || [];
}

/** Recipients for an event, resolved server-side from the paper's own records. */
async function resolveRecipients(admin, audience, paper, { assignee, actorId }) {
  if (audience === "author") return emailsFor(admin, [paper.submitted_by]);
  if (audience === "assignee") return emailsFor(admin, [assignee]);
  if (audience === "reviewers") {
    const { data } = await admin.from("paper_assignments").select("assignee").eq("paper_id", paper.id).in("role", REVIEWER_ROLES);
    return emailsFor(admin, (data || []).map((a) => a.assignee));
  }
  if (audience === "managers") {
    // The paper's editors; if it has none, the administrators. Never the author
    // (an admin who submitted a paper is its author, not its manager).
    const { data } = await admin.from("paper_assignments").select("assignee").eq("paper_id", paper.id).eq("role", "EDITOR");
    let ids = (data || []).map((a) => a.assignee);
    if (!ids.length) {
      const { data: admins } = await admin.from("profiles").select("id").eq("is_admin", true);
      ids = (admins || []).map((a) => a.id);
    }
    return uniqueRecipients(await emailsFor(admin, ids), [paper.submitted_by, actorId]);
  }
  return [];
}

/**
 * Send a workflow notification. Never throws: a notification failure must
 * never undo or fail the action that triggered it. Returns a small summary.
 */
export async function notify(event, { paperId, assignee = null, actorId = null, round, dueAt = null, publicPath = null }) {
  const audience = AUDIENCE[event];
  if (!audience || !paperId) return { sent: 0, failed: 0 };
  try {
    const admin = createAdminClient();
    const { data: paper } = await admin.from("papers").select("id, title, submitted_by, current_round").eq("id", paperId).maybeSingle();
    if (!paper) return { sent: 0, failed: 0 };
    const recipients = uniqueRecipients(await resolveRecipients(admin, audience, paper, { assignee, actorId }),
      audience === "author" ? [] : [actorId]);
    let sent = 0, failed = 0;
    for (const r of recipients) {
      const mail = buildNotification(event, {
        siteUrl: siteUrl(), paperId, title: paper.title, recipientId: r.id, actorId,
        round: Number.isInteger(round) ? round : paper.current_round ?? 0, dueAt,
        publicUrl: publicPath ? `${siteUrl()}${publicPath}` : null,
      });
      if (!mail) continue;
      const res = await sendEmail({ to: r.email, ...mail });
      if (res?.ok) sent++;
      else { failed++; console.error("notify: not delivered", JSON.stringify({ event, to: maskEmail(r.email), code: res?.code })); }
    }
    return { sent, failed };
  } catch (e) {
    console.error("notify: error", JSON.stringify({ event, message: e?.message }));
    return { sent: 0, failed: 0, error: true };
  }
}

/** Queue a notification to run after the response is sent. */
export function notifyLater(event, args) {
  after(() => notify(event, args));
}
