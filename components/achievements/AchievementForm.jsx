"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_TYPE_KEYS, ACHIEVEMENT_SCHOOLS, SCHOOL_LABEL, ACH_MAX_FILE_BYTES,
  validateAchievement, validateFileCounts, fileHint,
} from "@/lib/achievementTypes";

const ACCEPT = { pdf: ".pdf,application/pdf", docx: ".docx", doc: ".doc" };

function RadioPills({ name, label, options, value, onChange, error }) {
  return (
    <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {label} <span className="text-accent">*</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          const on = value === v;
          return (
            <label
              key={v}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                on ? "border-brand bg-brand-50 font-semibold text-brand" : "border-line bg-white text-ink hover:bg-soft",
              )}
            >
              <input type="radio" name={name} value={v} checked={on} onChange={() => onChange(v)} className="h-4 w-4 accent-[var(--color-brand)]" />
              {l}
            </label>
          );
        })}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function FileSlot({ slot, files, onChange, error }) {
  const accept = slot.types.map((t) => ACCEPT[t]).join(",");
  const [localError, setLocalError] = useState("");

  function onPick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    setLocalError("");
    const tooBig = picked.find((f) => f.size > ACH_MAX_FILE_BYTES);
    if (tooBig) { setLocalError(`“${tooBig.name}” is larger than 10 MB.`); return; }
    const next = slot.max === 1 ? picked.slice(0, 1) : [...files, ...picked];
    if (next.length > slot.max) { setLocalError(`You can attach at most ${slot.max} files here.`); return; }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {slot.label} <span className="text-accent">*</span>
      </p>
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors hover:bg-soft",
          error || localError ? "border-danger/60 bg-danger-soft/40" : "border-line bg-soft/50",
        )}
      >
        <Icon name="upload" size={22} className="text-brand" />
        <span className="font-semibold text-brand">{files.length && slot.max === 1 ? "Replace file" : "Choose file"}</span>
        <span className="text-xs text-muted">{fileHint(slot)}</span>
        <input type="file" className="sr-only" accept={accept} multiple={slot.max > 1} onChange={onPick} />
      </label>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="papers" size={16} className="shrink-0 text-muted" />
                <span className="truncate text-ink">{f.name}</span>
                <span className="shrink-0 text-xs text-muted">{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
              </span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-xs font-semibold text-danger hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {(localError || error) && <p className="text-xs text-danger">{localError || error}</p>}
    </div>
  );
}

function Field({ field, values, setValue, issues }) {
  const v = values[field.key] ?? "";
  const common = {
    label: field.label,
    required: field.required,
    error: issues[field.key],
    hint: field.hint,
    containerClassName: field.full ? "sm:col-span-2" : "",
  };
  if (field.kind === "select") {
    return (
      <>
        <Select
          {...common}
          label={<>{field.label} {field.required && <span className="text-accent">*</span>}</>}
          placeholder="Choose…"
          options={field.options}
          value={v}
          onChange={(e) => setValue(field.key, e.target.value)}
        />
        {field.other && v === "Other" && (
          <Input
            label="Please describe"
            required
            value={values[`${field.key}_other`] ?? ""}
            onChange={(e) => setValue(`${field.key}_other`, e.target.value)}
            error={issues[`${field.key}_other`]}
            containerClassName={field.full ? "sm:col-span-2" : ""}
          />
        )}
      </>
    );
  }
  if (field.kind === "textarea") {
    return (
      <Textarea
        {...common}
        label={<>{field.label} {field.required && <span className="text-accent">*</span>}</>}
        rows={3}
        value={v}
        onChange={(e) => setValue(field.key, e.target.value)}
      />
    );
  }
  const inputProps =
    field.kind === "number"
      ? { type: "text", inputMode: "decimal", placeholder: "e.g. 150000" }
      : field.kind === "url"
        ? { type: "url", placeholder: "https://" }
        : field.kind === "date"
          ? { type: "date", max: field.allowFuture ? undefined : new Date().toISOString().slice(0, 10) }
          : { type: "text" };
  return <Input {...common} {...inputProps} value={v} onChange={(e) => setValue(field.key, e.target.value)} />;
}

/**
 * The "Add achievement" form: pick a type, then fill in that type's fields.
 * The fields come from lib/achievementTypes.js and are validated with the same
 * rules the API uses; the server checks everything again.
 */
export default function AchievementForm({ me, initialType, onDone }) {
  const [type, setType] = useState(ACHIEVEMENT_TYPES[initialType] ? initialType : "");
  const [school, setSchool] = useState(me?.school || "");
  const [affiliation, setAffiliation] = useState("");
  const [values, setValues] = useState({});
  const [files, setFiles] = useState({});
  const [issues, setIssues] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const def = type ? ACHIEVEMENT_TYPES[type] : null;

  // Reset type-specific answers when the type changes; pre-fill the user's name where asked.
  useEffect(() => {
    if (!def) return;
    const init = {};
    for (const f of def.fields) if (f.prefill === "name" && me?.name) init[f.key] = me.name;
    setValues(init);
    setFiles({});
    setAffiliation("");
    setIssues({});
    setError("");
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!school && me?.school) setSchool(me.school);
  }, [me?.school]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = (k, v) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setIssues((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  const schoolOptions = useMemo(() => ACHIEVEMENT_SCHOOLS.map((s) => ({ value: s, label: SCHOOL_LABEL[s] })), []);

  async function onSubmit(e) {
    e.preventDefault();
    if (!def) return;
    setError("");
    const counts = Object.fromEntries(def.files.map((s) => [s.slot, (files[s.slot] || []).length]));
    const checked = validateAchievement(type, { school, affiliation, values });
    const fileIssues = validateFileCounts(type, counts);
    const all = { ...(checked.ok ? {} : checked.issues), ...fileIssues };
    if (Object.keys(all).length) {
      setIssues(all);
      setError("Some answers need attention. They're marked in red below.");
      return;
    }

    const fd = new FormData();
    fd.set("type", type);
    fd.set("school", school);
    if (def.affiliation) fd.set("affiliation", affiliation);
    fd.set("values", JSON.stringify(values));
    for (const s of def.files) for (const f of files[s.slot] || []) fd.append(`file_${s.slot}`, f);

    setSaving(true);
    try {
      const res = await fetch("/api/achievements", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIssues(data.issues || {});
        setError(data.error || "Could not save. Please try again.");
        setSaving(false);
        return;
      }
      onDone?.(data.id);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-accent">Step 1 · What kind of achievement is it?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ACHIEVEMENT_TYPE_KEYS.map((k) => {
            const t = ACHIEVEMENT_TYPES[k];
            const on = k === type;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                aria-pressed={on}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5 text-left transition-colors",
                  on ? "border-brand ring-2 ring-brand-100" : "border-line hover:border-brand-light",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-ink">{t.name}</span>
                  {on && <Icon name="check" size={18} className="text-brand" />}
                </span>
                <span className="text-xs leading-relaxed text-muted">{t.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {def && (
        <section>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-accent">Step 2 · Fill in the details</p>
          <Card className="p-5 sm:p-6">
            <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
              <Input label="Name" value={me?.name || ""} readOnly hint="From your profile" className="bg-soft! text-muted!" />
              <Input label="Email" value={me?.email || ""} readOnly hint="From your login" className="bg-soft! text-muted!" />

              <RadioPills name="school" label="School you belong to" options={schoolOptions} value={school} onChange={(v) => { setSchool(v); setIssues((p) => ({ ...p, school: undefined })); }} error={issues.school} />

              {def.fields.map((f) => (
                <Field key={f.key} field={f} values={values} setValue={setValue} issues={issues} />
              ))}

              {def.affiliation && (
                <RadioPills name="affiliation" label={def.affiliation.label} options={def.affiliation.options} value={affiliation} onChange={(v) => { setAffiliation(v); setIssues((p) => ({ ...p, affiliation: undefined })); }} error={issues.affiliation} />
              )}

              {def.files.map((s) => (
                <FileSlot
                  key={s.slot}
                  slot={s}
                  files={files[s.slot] || []}
                  onChange={(list) => { setFiles((p) => ({ ...p, [s.slot]: list })); setIssues((p) => ({ ...p, [`file_${s.slot}`]: undefined })); }}
                  error={issues[`file_${s.slot}`]}
                />
              ))}

              {error && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger sm:col-span-2">{error}</p>}

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:justify-end">
                <Button href="/achievements" variant="outline">Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Submit achievement"}</Button>
              </div>
            </form>
          </Card>
        </section>
      )}
    </div>
  );
}
