// Publication dashboard data (signed-in admins and EDITOR role holders only).
//   admin  → every volume/issue, every eligible paper and publication
//   editor → every volume/issue (to pick from), but only eligible papers and
//            publications for papers they are assigned to as EDITOR
// Eligible = papers.status ACCEPTED + communicated ACCEPT decision + no
// publication record yet. Author list here is names/affiliations only (the
// public snapshot) — never emails — and only for accepted papers.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOpenPublicationDashboard, defaultPublicationMeta } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canOpenPublicationDashboard(me)) return NextResponse.json({ error: "Publication management is restricted to administrators and editors." }, { status: 403 });

  try {
    const admin = createAdminClient();

    // Scope of papers the caller may manage.
    let scopeIds = null; // null = all (admin)
    if (!me.isAdmin) {
      const { data: mine } = await admin.from("paper_assignments").select("paper_id").eq("assignee", me.id).eq("role", "EDITOR");
      scopeIds = [...new Set((mine || []).map((a) => a.paper_id))];
    }

    const [{ data: volumes, error: ve }, { data: issues, error: ie }] = await Promise.all([
      admin.from("volumes").select("id, volume_number, year, title, description, status, published_at, created_at, updated_at")
        .order("year", { ascending: false }).order("volume_number", { ascending: false }),
      admin.from("issues").select("id, volume_id, issue_number, title, description, publication_date, status, published_at, created_at, updated_at")
        .order("issue_number", { ascending: true }),
    ]);
    if (ve || ie) throw ve || ie;

    const empty = scopeIds !== null && scopeIds.length === 0;
    let pubQ = admin.from("publications").select("id, paper_id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi, publication_date, manuscript_id, manuscript_public, status, version, scheduled_at, published_at, updated_at");
    let accQ = admin.from("papers").select("id, title, abstract, keywords, status, current_round, updated_at").eq("status", "ACCEPTED");
    if (scopeIds) { pubQ = pubQ.in("paper_id", scopeIds); accQ = accQ.in("id", scopeIds); }
    const [{ data: pubs }, { data: accepted }] = empty
      ? [{ data: [] }, { data: [] }]
      : await Promise.all([pubQ.order("updated_at", { ascending: false }), accQ]);

    // Eligible = accepted (communicated ACCEPT) and not yet in publications.
    const publishedPaperIds = new Set((pubs || []).map((p) => p.paper_id));
    const candidateIds = (accepted || []).map((p) => p.id).filter((id) => !publishedPaperIds.has(id));
    const allPaperIds = [...new Set([...candidateIds, ...(pubs || []).map((p) => p.paper_id)])];
    const none = Promise.resolve({ data: [] });
    const [{ data: decisions }, { data: authors }, { data: manuscripts }] = await Promise.all([
      candidateIds.length ? admin.from("editorial_decisions").select("paper_id, decision, released_at").in("paper_id", candidateIds) : none,
      // Names + affiliations only (the public author snapshot); never emails.
      candidateIds.length ? admin.from("paper_authors").select("paper_id, full_name, affiliation, author_order").in("paper_id", candidateIds) : none,
      allPaperIds.length ? admin.from("paper_manuscripts").select("id, paper_id, version, mime_type, byte_size, created_at").in("paper_id", allPaperIds) : none,
    ]);

    const by = (list, key = "paper_id") => {
      const m = new Map();
      (list || []).forEach((x) => m.set(x[key], [...(m.get(x[key]) || []), x]));
      return m;
    };
    const decBy = by(decisions), authBy = by(authors), msBy = by(manuscripts);
    const msShape = (list) => (list || []).sort((a, b) => a.version - b.version)
      .map((m) => ({ id: m.id, version: m.version, mimeType: m.mime_type, byteSize: m.byte_size, uploadedAt: m.created_at }));

    const eligible = (accepted || [])
      .filter((p) => !publishedPaperIds.has(p.id))
      .filter((p) => (decBy.get(p.id) || []).some((d) => d.decision === "ACCEPT" && d.released_at))
      .map((p) => ({
        paperId: p.id,
        title: p.title,
        acceptedAt: (decBy.get(p.id) || []).find((d) => d.decision === "ACCEPT")?.released_at || p.updated_at,
        defaults: defaultPublicationMeta(p, authBy.get(p.id), msBy.get(p.id)),
        manuscripts: msShape(msBy.get(p.id)),
      }));

    const publications = (pubs || []).map((p) => ({
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
        volumes: (volumes || []).length,
        issues: (issues || []).length,
      },
      volumes: (volumes || []).map((v) => ({ ...v, issues: (issues || []).filter((i) => i.volume_id === v.id) })),
      eligible,
      publications,
    });
  } catch (e) {
    console.error("publications manage GET:", e?.message);
    return NextResponse.json({ error: "Could not load publication management." }, { status: 500 });
  }
}
