import "server-only";

import { after } from "next/server";
import { db, T } from "@/lib/db";
import { siteUrl } from "@/lib/config/env";
import { sendEmail } from "@/lib/email/send";
import { maskEmail } from "@/lib/email/core";
import { AUDIENCE, buildNotification, uniqueRecipients } from "@/lib/notifications";

const REVIEWER_ROLES = ["PEER_REVIEWER", "DESK_REVIEWER"];

async function emailsFor(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return [];
  return db.query(`SELECT id, email FROM \`${T.users}\` WHERE id IN (?) AND status = 'ACTIVE'`, [list]);
}

/** Recipients for an event, resolved server-side from the paper's own records. */
async function resolveRecipients(audience, paper, { assignee, actorId }) {
  if (audience === "author") return emailsFor([paper.submitted_by]);
  if (audience === "assignee") return emailsFor([assignee]);
  if (audience === "reviewers") {
    const rows = await db.query(`SELECT assignee FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND role IN (?)`, [paper.id, REVIEWER_ROLES]);
    return emailsFor(rows.map((a) => a.assignee));
  }
  if (audience === "managers") {
    // The paper's editors; if it has none, the administrators. Never the author
    // (an admin who submitted a paper is its author, not its manager).
    let ids = (await db.query(`SELECT assignee FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND role = 'EDITOR'`, [paper.id])).map((a) => a.assignee);
    if (!ids.length) ids = (await db.query(`SELECT id FROM \`${T.users}\` WHERE isAdmin = 1`)).map((a) => a.id);
    return uniqueRecipients(await emailsFor(ids), [paper.submitted_by, actorId]);
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
    const paper = await db.one(`SELECT id, title, submitted_by, current_round FROM \`${T.papers}\` WHERE id = ?`, [paperId]);
    if (!paper) return { sent: 0, failed: 0 };
    const recipients = uniqueRecipients(await resolveRecipients(audience, paper, { assignee, actorId }),
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
    console.error("notify: error", JSON.stringify({ event, code: e?.code, message: e?.message }));
    return { sent: 0, failed: 0, error: true };
  }
}

/** Queue a notification to run after the response is sent. */
export function notifyLater(event, args) {
  after(() => notify(event, args));
}
