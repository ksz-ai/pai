import { getDb, nowIso, uuid } from "@/lib/db";
import type { EvidenceRef, ProfileEntryDTO, ProfileLogDTO } from "@/lib/types";

export interface EntryRow {
  id: string;
  user_id: string;
  concept_id: string;
  mastery: number;
  source_type: "system" | "user";
  evidence_refs: string;
  last_touched_at: string;
  protected_until: string | null;
  updated_at: string;
}

export interface ConceptRow {
  id: string;
  name: string;
  aliases: string;
  domain: string;
  created_at: string;
}

export function listEntries(userId: string): ProfileEntryDTO[] {
  const rows = getDb()
    .prepare(
      `SELECT pe.*, c.name AS concept_name, c.domain FROM profile_entries pe
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pe.user_id = ? ORDER BY pe.updated_at DESC`,
    )
    .all(userId) as Array<EntryRow & { concept_name: string; domain: string }>;
  return rows.map((r) => ({
    id: r.id,
    concept_name: r.concept_name,
    domain: r.domain,
    mastery: r.mastery,
    source_type: r.source_type,
    protected_until: r.protected_until,
    last_touched_at: r.last_touched_at,
    updated_at: r.updated_at,
    evidence_refs: JSON.parse(r.evidence_refs || "[]") as EvidenceRef[],
  }));
}

export function getEntry(id: string, userId: string): EntryRow | undefined {
  return getDb().prepare("SELECT * FROM profile_entries WHERE id = ? AND user_id = ?").get(id, userId) as EntryRow | undefined;
}

export function findEntryByConceptName(userId: string, name: string): (EntryRow & { concept_name: string; domain: string }) | undefined {
  return getDb()
    .prepare(
      `SELECT pe.*, c.name AS concept_name, c.domain FROM profile_entries pe
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pe.user_id = ? AND c.name = ?`,
    )
    .get(userId, name.trim()) as (EntryRow & { concept_name: string; domain: string }) | undefined;
}

export function upsertConcept(name: string, domain?: string): ConceptRow {
  const db = getDb();
  const trimmed = name.trim();
  const existing = db.prepare("SELECT * FROM concepts WHERE name = ?").get(trimmed) as ConceptRow | undefined;
  if (existing) {
    if (domain && existing.domain === "未分类") {
      db.prepare("UPDATE concepts SET domain = ? WHERE id = ?").run(domain, existing.id);
      existing.domain = domain;
    }
    return existing;
  }
  const id = uuid();
  db.prepare("INSERT INTO concepts (id, name, aliases, domain, created_at) VALUES (?,?,?,?,?)").run(
    id,
    trimmed,
    "[]",
    domain?.trim() || "未分类",
    nowIso(),
  );
  return { id, name: trimmed, aliases: "[]", domain: domain?.trim() || "未分类", created_at: nowIso() };
}

export function getConcept(id: string): ConceptRow | undefined {
  return getDb().prepare("SELECT * FROM concepts WHERE id = ?").get(id) as ConceptRow | undefined;
}

export function listConceptNames(limit = 80): string[] {
  const rows = getDb().prepare("SELECT name FROM concepts ORDER BY created_at DESC LIMIT ?").all(limit) as { name: string }[];
  return rows.map((r) => r.name);
}

export function insertEntry(opts: { userId: string; conceptId: string; mastery: number; evidence?: EvidenceRef[]; sourceType?: "system" | "user"; protectedUntil?: string | null }): string {
  const id = uuid();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO profile_entries (id, user_id, concept_id, mastery, source_type, evidence_refs, last_touched_at, protected_until, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      opts.userId,
      opts.conceptId,
      opts.mastery,
      opts.sourceType ?? "system",
      JSON.stringify(opts.evidence ?? []),
      ts,
      opts.protectedUntil ?? null,
      ts,
    );
  return id;
}

export function updateEntryMastery(id: string, mastery: number, opts?: { sourceType?: "system" | "user"; protectedUntil?: string | null }) {
  getDb()
    .prepare(
      `UPDATE profile_entries SET mastery = ?,
         source_type = COALESCE(?, source_type),
         protected_until = CASE WHEN ? IS NOT NULL THEN ? ELSE protected_until END,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(mastery, opts?.sourceType ?? null, opts?.protectedUntil ?? null, opts?.protectedUntil ?? null, nowIso(), id);
}

export function touchEntry(id: string) {
  getDb().prepare("UPDATE profile_entries SET last_touched_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
}

export function addEvidence(id: string, ref: EvidenceRef) {
  const db = getDb();
  const row = db.prepare("SELECT evidence_refs FROM profile_entries WHERE id = ?").get(id) as { evidence_refs: string } | undefined;
  if (!row) return;
  const refs = JSON.parse(row.evidence_refs || "[]") as EvidenceRef[];
  if (refs.some((r) => r.id === ref.id)) return;
  refs.push(ref);
  if (refs.length > 20) refs.splice(0, refs.length - 20);
  db.prepare("UPDATE profile_entries SET evidence_refs = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(refs), nowIso(), id);
}

export function deleteEntry(id: string) {
  getDb().prepare("DELETE FROM profile_entries WHERE id = ?").run(id);
  getDb().prepare("DELETE FROM profile_logs WHERE profile_entry_id = ?").run(id);
}

export function entriesTouchedBefore(userId: string, iso: string): EntryRow[] {
  return getDb()
    .prepare("SELECT * FROM profile_entries WHERE user_id = ? AND last_touched_at < ?")
    .all(userId, iso) as EntryRow[];
}

export function insertLog(entryId: string, oldValue: number | null, newValue: number | null, signalType: string, detail?: string) {
  getDb()
    .prepare(
      "INSERT INTO profile_logs (id, profile_entry_id, old_value, new_value, signal_type, detail, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(uuid(), entryId, oldValue, newValue, signalType, detail ?? null, nowIso());
}

export function logsOfEntry(entryId: string): ProfileLogDTO[] {
  const rows = getDb()
    .prepare(
      `SELECT pl.*, c.name AS concept_name FROM profile_logs pl
       JOIN profile_entries pe ON pe.id = pl.profile_entry_id
       JOIN concepts c ON c.id = pe.concept_id
       WHERE pl.profile_entry_id = ? ORDER BY pl.created_at DESC LIMIT 50`,
    )
    .all(entryId) as Array<{
    id: string;
    concept_name: string;
    old_value: number | null;
    new_value: number | null;
    signal_type: string;
    detail: string | null;
    created_at: string;
  }>;
  return rows;
}
