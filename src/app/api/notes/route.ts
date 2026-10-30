import { NextRequest, NextResponse } from "next/server";
import { getDb, getDefaultUserId } from "@/lib/db";
import { listNotes } from "@/lib/db/repo/notes";
import { getCustomDomains, addCustomDomain } from "@/lib/db/repo/settings";

/** 自定义分类标签（N4）：新建空标签（可拖拽笔记进来） */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "标签名不能为空" }, { status: 400 });
  addCustomDomain(body.name);
  return NextResponse.json({ ok: true, customDomains: getCustomDomains() });
}

/** 笔记列表：?q= 搜索、?domain= 领域筛选、?sort=updated|created、?grouped=1 按概念归组 */
export async function GET(req: NextRequest) {
  const userId = getDefaultUserId();
  const sp = new URL(req.url).searchParams;

  if (sp.get("grouped")) {
    // 按概念归组（B-1）：每篇笔记只归入其【主要概念】——在笔记内容中出现位置最早的概念
    // （标题/主题概念天然最早），同义概念组（如 API/接口 指向同一篇）因此合并为一组
    const all = listNotes(userId, { withContent: true });
    const rels = getDb()
      .prepare(
        `SELECT nc.note_id, c.id AS concept_id, c.name AS concept_name, c.domain AS concept_domain
         FROM note_concepts nc JOIN concepts c ON c.id = nc.concept_id`,
      )
      .all() as Array<{ note_id: string; concept_id: string; concept_name: string; concept_domain: string }>;
    const groups = new Map<string, { concept_id: string; concept_name: string; domain: string; notes: typeof all }>();
    const ungrouped: typeof all = [];
    for (const n of all) {
      const mine = rels.filter((r) => r.note_id === n.id);
      if (mine.length === 0) {
        ungrouped.push(n);
        continue;
      }
      const primary = [...mine].sort((a, b) => {
        const pa = n.content.indexOf(a.concept_name);
        const pb = n.content.indexOf(b.concept_name);
        if (pa !== pb) return (pa < 0 ? Infinity : pa) - (pb < 0 ? Infinity : pb);
        return b.concept_name.length - a.concept_name.length;
      })[0];
      const g = groups.get(primary.concept_id) ?? {
        concept_id: primary.concept_id,
        concept_name: primary.concept_name,
        domain: primary.concept_domain,
        notes: [] as typeof all,
      };
      g.notes.push(n);
      groups.set(primary.concept_id, g);
    }
    return NextResponse.json({
      groups: [...groups.values()].sort((a, b) => b.notes.length - a.notes.length),
      ungrouped,
      customDomains: getCustomDomains(),
    });
  }

  const notes = listNotes(userId, {
    q: sp.get("q")?.trim() || undefined,
    domain: sp.get("domain")?.trim() || undefined,
    sort: sp.get("sort") === "created" ? "created" : "updated",
  });
  // 领域 chips 数据（不受当前筛选影响，取全量分布）+ 自定义标签
  const all = listNotes(userId);
  const dist = new Map<string, number>();
  for (const n of all) dist.set(n.domain, (dist.get(n.domain) ?? 0) + 1);
  return NextResponse.json({
    notes,
    domains: [...dist.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
    customDomains: getCustomDomains(),
  });
}
