"use client";

import { useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import NoAccessMessage from "@/components/achievements/NoAccessMessage";
import { useRole } from "@/components/layout/RoleContext";
import { cn } from "@/lib/cn";

const TYPE_LABEL = {
  PAPER: "Research papers", BOOK: "Books & chapters", EVENT_ATTENDED: "Events attended", AWARD: "Awards",
  PROFESSIONAL: "Professional achievements", PATENT: "Patents & copyrights", CONSULTANCY: "Consultancy",
  ORCID: "ORCID iDs", FELLOWSHIP: "Fellowships", QUALIFICATION: "Qualifications", EVENT_ORGANIZED: "Events organised", GRANT: "Grants",
};

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums", tone || "text-ink")}>{value}</p>
    </div>
  );
}

function FilePick({ label, hint, accept, file, onFile, required }) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-lg border-2 border-dashed border-line bg-soft/50 px-4 py-4 hover:bg-soft">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label} {required && <span className="text-accent">*</span>}</span>
      <span className="flex items-center gap-2 text-sm font-semibold text-brand">
        <Icon name="upload" size={18} /> {file ? file.name : "Choose file"}
      </span>
      <span className="text-xs text-muted">{hint}</span>
      <input type="file" className="sr-only" accept={accept} onChange={(e) => onFile(e.target.files?.[0] || null)} />
    </label>
  );
}

export default function ImportAchievementsPage() {
  const { realRole } = useRole();
  const [workbook, setWorkbook] = useState(null);
  const [contributors, setContributors] = useState(null);
  const [download, setDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { token, summary }
  const [run, setRun] = useState(null); // { total, remaining, imported, filesStored, linksKept, failed, accounts, reasons, done, orcids }
  const stopRef = useRef(false);

  if (realRole !== "administrator") return <NoAccessMessage />;

  async function doPreview(e) {
    e.preventDefault();
    if (!workbook) { setError("Choose the Excel workbook first."); return; }
    setBusy(true); setError(""); setPreview(null); setRun(null);
    const fd = new FormData();
    fd.set("workbook", workbook);
    if (contributors) fd.set("contributors", contributors);
    try {
      const res = await fetch("/api/achievements/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not read the file.");
      setPreview(data);
    } catch (e2) { setError(e2.message); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!preview) return;
    setBusy(true); setError(""); stopRef.current = false;
    let acc = run && !run.done ? run : { total: preview.summary.entries, remaining: preview.summary.toImport, imported: 0, filesStored: 0, linksKept: 0, failed: 0, accounts: 0, reasons: {}, done: false, orcids: null };
    setRun(acc);
    try {
      for (;;) {
        const res = await fetch("/api/achievements/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run", token: preview.token, download }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "The import stopped.");
        const reasons = { ...acc.reasons };
        for (const [k, v] of Object.entries(d.reasons || {})) reasons[k] = (reasons[k] || 0) + v;
        acc = {
          ...acc,
          remaining: d.remaining,
          imported: acc.imported + d.imported,
          filesStored: acc.filesStored + d.filesStored,
          linksKept: acc.linksKept + d.linksKept,
          failed: acc.failed + d.failed,
          accounts: acc.accounts + (d.accountsCreated || 0),
          reasons,
          done: d.done,
          orcids: d.orcidsSaved ?? acc.orcids,
        };
        setRun(acc);
        if (d.done) break;
        if (d.imported === 0 && d.failed > 0) throw new Error(`${d.failed} row(s) could not be imported. Check the server log, then press “Continue import”.`);
        if (stopRef.current) break;
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function discard() {
    if (preview?.token) {
      await fetch("/api/achievements/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard", token: preview.token }) }).catch(() => {});
    }
    setPreview(null); setRun(null); setError(""); setWorkbook(null); setContributors(null);
  }

  const s = preview?.summary;
  const pct = run ? Math.round(((run.total - run.remaining) / Math.max(1, run.total)) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Import from Google Forms"
        subtitle="Bring the old “Faculty Research & Academic Achievements” Google Forms data into the portal. Nothing is written until you press Import."
        action={<Button href="/achievements/all" variant="outline">All achievements</Button>}
      />

      {!preview && (
        <Card className="p-5 sm:p-6">
          <form className="flex flex-col gap-4" onSubmit={doPreview}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FilePick
                label="Achievements workbook (.xlsx)"
                hint="The Google Sheet with all the form responses (Research Papers, Books, Awards, Patents, ORCID…). In Google Sheets: File → Download → Microsoft Excel."
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                file={workbook} onFile={setWorkbook} required
              />
              <FilePick
                label="Contributors list (.csv, optional)"
                hint="Columns: name, email, school. Names exactly as written on entries the office submitted (e.g. patents), so those faculty see them."
                accept=".csv,text/csv"
                file={contributors} onFile={setContributors}
              />
            </div>
            <p className="flex gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
              Only upload the achievements workbook. Never upload staff files with PAN, Aadhaar or bank details — they aren’t needed.
            </p>
            {error && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !workbook}>{busy ? "Reading the file…" : "Preview import"}</Button>
            </div>
          </form>
        </Card>
      )}

      {s && (
        <div className="flex flex-col gap-5">
          <Card className="p-5 sm:p-6">
            <h2 className="text-base font-bold text-ink">Preview</h2>
            <p className="mt-0.5 text-sm text-muted">This is what the import will do. Nothing has been written yet.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Entries in the file" value={s.entries} />
              <Stat label="To import now" value={s.toImport} tone="text-brand" />
              <Stat label="Already imported" value={s.alreadyImported} />
              <Stat label="Proof links" value={s.proofLinks} />
              <Stat label="People" value={s.people} />
              <Stat label="Accounts to create" value={s.accountsToCreate} tone="text-brand" />
              <Stat label="Already have accounts" value={s.existingAccounts} />
              <Stat label="ORCID iDs" value={s.orcids} />
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="py-2 font-semibold">Sheet</th><th className="py-2 font-semibold">Becomes</th><th className="py-2 text-right font-semibold">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sheets.map((sh) => (
                    <tr key={sh.name} className="border-b border-line/60">
                      <td className="py-1.5 text-ink">{sh.name}</td>
                      <td className="py-1.5 text-muted">{TYPE_LABEL[sh.type] || sh.type}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink">{sh.count}{sh.skipped ? <span className="text-muted"> (+{sh.skipped} skipped)</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-4 flex flex-col gap-1.5 text-sm text-ink">
              <li>• New accounts are <b>Faculty</b> accounts with no password, no admin rights and no roles. Those people just use <b>Sign in with Google</b>.</li>
              <li>• Every entry is added as <b>Awaiting check</b>, with its original form date.</li>
              <li>• Entries the office submitted: <b>{s.officeMatched}</b> names matched to a person{s.contributorPairs ? ` (${s.contributorPairs} from your contributors list)` : ""}; <b>{s.officeUnmatched}</b> names kept as text only (usually students).</li>
              {s.noDate > 0 && <li>• <b>{s.noDate}</b> entries have a date that couldn’t be read (for example “1 year”). The original text is kept.</li>}
              {s.skippedRows > 0 && <li>• <b>{s.skippedRows}</b> rows will be skipped: {s.skippedReasons.join("; ")}.</li>}
              {s.unknownSheets.length > 0 && <li>• Sheets not recognised (ignored): {s.unknownSheets.join(", ")}.</li>}
              {s.authorAccounts.length > 0 && <li className="text-danger">• These emails belong to external author accounts and can’t open Achievements: {s.authorAccounts.join(", ")}.</li>}
            </ul>
            {s.topUnmatchedNames.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-brand">Names without an email ({s.topUnmatchedNames.length} most frequent)</summary>
                <p className="mt-1 text-xs text-muted">If one of these is a faculty member, add them to the contributors list and preview again.</p>
                <p className="mt-1 text-ink">{s.topUnmatchedNames.map(([n, c]) => `${n} (${c})`).join(", ")}</p>
              </details>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-base font-bold text-ink">Import</h2>
            <label className="mt-3 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={download} onChange={(e) => setDownload(e.target.checked)} disabled={busy || !!run} />
              <span>
                <b>Try to copy each proof file from Google Drive into the portal.</b> Works only for files shared as “Anyone with the link”.
                Files that can’t be copied keep their Drive link, and the faculty member is asked to upload them. This makes the import slower.
              </span>
            </label>

            {run && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="h-3 w-full overflow-hidden rounded-full bg-soft-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm text-muted">{run.done ? "Finished." : busy ? `Importing… ${pct}%` : `Paused at ${pct}%.`} {run.total - run.remaining} of {run.total} entries are in the portal.</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Stat label="Imported now" value={run.imported} tone="text-ok" />
                  <Stat label="Accounts created" value={run.accounts} />
                  <Stat label="Files copied" value={run.filesStored} />
                  <Stat label="Drive links kept" value={run.linksKept} tone={run.linksKept ? "text-warn" : "text-ink"} />
                  <Stat label="Failed" value={run.failed} tone={run.failed ? "text-danger" : "text-ink"} />
                </div>
                {Object.keys(run.reasons).length > 0 && (
                  <p className="text-xs text-muted">Why some files weren’t copied: {Object.entries(run.reasons).map(([k, v]) => `${k} (${v})`).join(", ")}.</p>
                )}
                {run.done && (
                  <p className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-sm text-ok">
                    <Icon name="check" size={18} /> Import complete.{run.orcids != null ? ` ${run.orcids} ORCID iDs saved.` : ""} The uploaded files have been deleted from the server.
                  </p>
                )}
              </div>
            )}

            {error && <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {!run?.done && <Button variant="outline" onClick={discard} disabled={busy}>Cancel</Button>}
              {busy && <Button variant="outline" onClick={() => { stopRef.current = true; }}>Pause</Button>}
              {!run?.done && !busy && (
                <Button onClick={doImport} disabled={busy || (s.toImport === 0 && s.orcids === 0)}>
                  {run ? "Continue import" : `Import ${s.toImport} entries`}
                </Button>
              )}
              {run?.done && <Button href="/achievements/all">See all achievements</Button>}
              {run?.done && <Button variant="outline" onClick={discard}>Import another file</Button>}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
