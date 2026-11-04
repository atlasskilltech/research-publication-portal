// Publication dashboard data (signed-in admins and EDITOR role holders only).
//   admin  → every volume/issue, every eligible paper and publication
//   editor → every volume/issue (to pick from), but only eligible papers and
//            publications for papers they are assigned to as EDITOR
// Eligible = papers.status ACCEPTED + communicated ACCEPT decision + no
// publication record yet. Author list here is names/affiliations only (the
// public snapshot) — never emails — and only for accepted papers.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { jrows } from "@/lib/repos/rows.mjs";
import { canOpenPublicationDashboard, defaultPublicationMeta } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUB_COLS = `id, paper_id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi,
  publication_date, manuscript_id, manuscript_public, status, version, scheduled_at, published_at, updated_at`;

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canOpenPublicationDashboard(me)) return NextResponse.json({ error: "Publication management is restricted to administrators and editors." }, { status: 403 });

  try {
    // Scope of papers the caller may manage.
    let scopeIds = null; // null = all (admin)
    if (!me.isAdmin) {
      const mine = await db.query(`SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR'`, [me.id]);
      scopeIds = [...new Set(mine.map((a) => a.paper_id))];
    }

    const [volumes, issues] = await Promise.all([
      db.query(`SELECT id, volume_number, year, title, description, status, published_at, created_at, updated_at
                  FROM \`${T.volumes}\` ORDER BY year DESC, volume_number DESC`),
      db.query(`SELECT id, volume_id, issue_number, title, description, publication_date, status, published_at, created_at, updated_at
                  FROM \`${T.issues}\` ORDER BY issue_number ASC`),
    ]);

    const empty = scopeIds !== null && scopeIds.length === 0;
    let pubs = [], accepted = [];
    if (!empty) {
      [pubs, accepted] = scopeIds
        ? await Promise.all([
            db.query(`SELECT ${PUB_COLS} FROM \`${T.publications}\` WHERE paper_id IN (?) ORDER BY updated_at DESC`, [scopeIds]).then(jrows),
            db.query(`SELECT id, title, abstract, keywords, status, current_round, updated_at FROM \`${T.papers}\` WHERE status = 'ACCEPTED' AND id IN (?)`, [scopeIds]).then(jrows),
          ])
        : await Promise.all([
            db.query(`SELECT ${PUB_COLS} FROM \`${T.publications}\` ORDER BY updated_at DESC`).then(jrows),
            db.query(`SELECT id, title, abstract, keywords, status, current_round, updated_at FROM \`${T.papers}\` WHERE status = 'ACCEPTED'`).then(jrows),
          ]);
    }

    // Eligible = accepted (communicated ACCEPT) and not yet in publications.
    const publishedPaperIds = new Set(pubs.map((p) => p.paper_id));
    const candidateIds = accepted.map((p) => p.id).filter((id) => !publishedPaperIds.has(id));
    const allPaperIds = [...new Set([...candidateIds, ...pubs.map((p) => p.paper_id)])];
    const none = Promise.resolve([]);
    const [decisions, authors, manuscripts] = await Promise.all([
      candidateIds.length
        ? db.query(`SELECT paper_id, decision, released_at FROM \`${T.editorialDecisions}\` WHERE paper_id IN (?)`, [candidateIds])
        : none,
      // Names + affiliations only (the public author snapshot); never emails.
      candidateIds.length
        ? db.query(`SELECT paper_id, full_name, affiliation, author_order FROM \`${T.paperAuthors}\` WHERE paper_id IN (?)`, [candidateIds])
        : none,
      allPaperIds.length
        ? db.query(`SELECT id, paper_id, version, mime_type, byte_size, created_at FROM \`${T.paperManuscripts}\` WHERE paper_id IN (?)`, [allPaperIds])
        : none,
    ]);

    const by = (list, key = "paper_id") => {
      const m = new Map();
      (list || []).forEach((x) => m.set(x[key], [...(m.get(x[key]) || []), x]));
      return m;
    };
    const decBy = by(decisions), authBy = by(authors), msBy = by(manuscripts);
    const msShape = (list) => (list || []).sort((a, b) => a.version - b.version)
      .map((m) => ({ id: m.id, version: m.version, mimeType: m.mime_type, byteSize: m.byte_size, uploadedAt: m.created_at }));

    const eligible = accepted
      .filter((p) => !publishedPaperIds.has(p.id))
      .filter((p) => (decBy.get(p.id) || []).some((d) => d.decision === "ACCEPT" && d.released_at))
      .map((p) => ({
        paperId: p.id,
        title: p.title,
        acceptedAt: (decBy.get(p.id) || []).find((d) => d.decision === "ACCEPT")?.released_at || p.updated_at,
        defaults: defaultPublicationMeta(p, authBy.get(p.id), msBy.get(p.id)),
        manuscripts: msShape(msBy.get(p.id)),
      }));

    const publications = pubs.map((p) => ({
      id: p.id,
      paperId: p.paper_id,
      volumeId: p.volume_id,
      issueId: p.issue_id,
      title: p.title,
      abstract: p.abstract,
      authors: p.authors || [],
      keywords: p.keywords || [],
      pageStart: p.page_start,
      pageEnd: p.page_end,
      doi: p.doi,
      publicationDate: p.publication_date,
      manuscriptId: p.manuscript_id,
      manuscriptPublic: p.manuscript_public,
      status: p.status,
      version: p.version,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      manuscripts: msShape(msBy.get(p.paper_id)),
    }));

    return NextResponse.json({
      canManageVolumes: !!me.isAdmin,
      summary: {
        awaiting: eligible.length,
        scheduled: publications.filter((p) => p.status === "SCHEDULED").length,
        published: publications.filter((p) => p.status === "PUBLISHED").length,
        volumes: volumes.length,
        issues: issues.length,
      },
      volumes: volumes.map((v) => ({ ...v, issues: issues.filter((i) => i.volume_id === v.id) })),
      eligible,
      publications,
    });
  } catch (e) {
    console.error("publications manage GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load publication management." }, { status: 500 });
  }
}
