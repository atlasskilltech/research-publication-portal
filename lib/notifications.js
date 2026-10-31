// Workflow notification emails (pure: no env, DB or SDK — unit-tested in
// scripts/test-notifications.mjs). lib/notifyServer.js resolves recipients and
// sends these through Resend.
//
// Privacy rules (same as the portal itself):
//   * reviewer emails never contain author names (double-blind);
//   * author emails never contain reviewer identity, scores or decision text —
//     they only say something is ready and link to the portal, where access
//     control applies;
//   * no tokens or secrets in any email.
import { idempotencyKey } from "./email/core.js";
import { editorialNotificationEmail } from "./email/templates.js";

export const EVENTS = {
  SUBMISSION_RECEIVED: "SUBMISSION_RECEIVED", // → author
  REVIEW_ASSIGNED: "REVIEW_ASSIGNED",         // → the assigned reviewer
  EDITOR_ASSIGNED: "EDITOR_ASSIGNED",         // → the assigned editor
  REVIEW_SUBMITTED: "REVIEW_SUBMITTED",       // → paper managers
  DECISION_AVAILABLE: "DECISION_AVAILABLE",   // → author
  REVISION_SUBMITTED: "REVISION_SUBMITTED",   // → paper managers
  REREVIEW_REQUESTED: "REREVIEW_REQUESTED",   // → the paper's reviewers
  PAPER_PUBLISHED: "PAPER_PUBLISHED",         // → author
};

/** Who receives each event: "author" | "reviewers" | "managers" | "assignee". */
export const AUDIENCE = {
  SUBMISSION_RECEIVED: "author",
  REVIEW_ASSIGNED: "assignee",
  EDITOR_ASSIGNED: "assignee",
  REVIEW_SUBMITTED: "managers",
  DECISION_AVAILABLE: "author",
  REVISION_SUBMITTED: "managers",
  REREVIEW_REQUESTED: "reviewers",
  PAPER_PUBLISHED: "author",
};

const clip = (s, n = 200) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || "Untitled submission";
};

function formatDate(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toUTCString().slice(0, 16);
}

/**
 * Build one email.
 * @param {string} event  one of EVENTS
 * @param {{ siteUrl:string, paperId:string, title:string, recipientId:string,
 *           round?:number, dueAt?:string|null, publicUrl?:string|null, actorId?:string|null }} c
 * @returns {{ subject, html, text, purpose, key } | null}  null = unknown event
 */
export function buildNotification(event, c) {
  const site = String(c.siteUrl || "").replace(/\/+$/, "");
  const title = clip(c.title);
  const round = Number.isInteger(c.round) ? c.round : 0;
  const due = formatDate(c.dueAt);
  const paperUrl = `${site}/submissions/${c.paperId}`;
  const footerNote = "You are receiving this because of your role on this submission in the Research Publication Portal.";

  const spec = {
    SUBMISSION_RECEIVED: {
      subject: "Submission Received",
      heading: "We received your submission",
      paragraphs: [`Your manuscript “${title}” has been submitted successfully.`, "An administrator will review it and assign reviewers. You can follow its progress in the portal."],
      cta: { label: "View Submission", url: paperUrl },
    },
    REVIEW_ASSIGNED: {
      subject: "New Review Assignment",
      heading: "A manuscript is waiting for your review",
      paragraphs: [`You have been assigned to review “${title}”.`, due ? `Please submit your review by ${due}.` : "Please submit your review at your earliest convenience.", "This is a double-blind review: author details are not shown."],
      cta: { label: "Open Review", url: paperUrl },
    },
    EDITOR_ASSIGNED: {
      subject: "Editor Assignment",
      heading: "You are the editor for a submission",
      paragraphs: [`You have been assigned as editor of “${title}”.`, "You will be able to make the editorial decision once reviews are submitted."],
      cta: { label: "Open Submission", url: paperUrl },
    },
    REVIEW_SUBMITTED: {
      subject: "Review Submitted",
      heading: "A review was submitted",
      paragraphs: [`A reviewer submitted their review of “${title}”${round ? ` (revision round ${round})` : ""}.`],
      cta: { label: "View Reviews", url: paperUrl },
    },
    DECISION_AVAILABLE: {
      subject: "Editorial Decision Available",
      heading: "A decision on your submission is available",
      paragraphs: [`The editors have made a decision on “${title}”.`, "Sign in to the portal to read the decision and any reviewer comments."],
      cta: { label: "View Decision", url: paperUrl },
    },
    REVISION_SUBMITTED: {
      subject: "Revision Submitted",
      heading: "The author submitted a revision",
      paragraphs: [`A revised manuscript for “${title}” (revision ${round}) has been submitted.`, "Release it to the reviewers when you are ready."],
      cta: { label: "Open Submission", url: paperUrl },
    },
    REREVIEW_REQUESTED: {
      subject: "Revised Manuscript Ready for Review",
      heading: "A revised manuscript is ready for you",
      paragraphs: [`A revised version of “${title}” is ready for re-review (round ${round}).`, due ? `Please submit your review by ${due}.` : "Please submit your review at your earliest convenience."],
      cta: { label: "Open Review", url: paperUrl },
    },
    PAPER_PUBLISHED: {
      subject: "Your Paper Has Been Published",
      heading: "Congratulations — your paper is published",
      paragraphs: [`“${title}” is now published in the Research Publication Portal.`],
      cta: { label: "View Publication", url: c.publicUrl || paperUrl },
    },
  }[event];
  if (!spec) return null;

  const mail = editorialNotificationEmail({ siteUrl: site, subject: spec.subject, heading: spec.heading, paragraphs: spec.paragraphs, cta: spec.cta, footerNote });
  return {
    ...mail,
    purpose: `notify_${event.toLowerCase()}`,
    // Same event, paper, recipient, round AND triggering user is never delivered
    // twice (retries are suppressed; three reviewers submitting in one round are
    // three different events and each is delivered).
    key: idempotencyKey(`notify-${event}`, c.paperId, c.recipientId, round, c.actorId || ""),
  };
}

/** Unique, non-empty recipients, never the excluded ids (e.g. the actor). */
export function uniqueRecipients(rows, exclude = []) {
  const seen = new Set();
  const skip = new Set(exclude.filter(Boolean));
  const out = [];
  for (const r of rows || []) {
    if (!r?.id || !r?.email || skip.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
