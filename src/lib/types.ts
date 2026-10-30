/** 前后端共享的 DTO 类型定义 */

export type Role = "user" | "assistant";
export type MessageStatus = "normal" | "streaming" | "incomplete" | "stale";
export type FeedbackKind = "too_verbose" | "more_detail" | "rephrase";
export type DepthLevel = 0 | 1 | 2;

export const DEPTH_LABELS: Record<DepthLevel, string> = {
  0: "L0 · 一句话＋类比",
  1: "L1 · 定义＋例子",
  2: "L2 · 原理＋增量",
};

/** AI 消息的判档依据（FR-03 ⑤ 可解释性） */
export interface MessageMeta {
  depth: DepthLevel;
  concept_name: string | null;
  domain: string | null;
  profile_hit: boolean;
  used_entries: { name: string; mastery: number }[];
  missing_prereqs: { name: string; mastery: number }[];
  evidence: { slot: number; excerpt: string }[];
  feedback?: FeedbackKind;
  notice?: string;
  model?: string;
  prompt_version?: string;
  /** 导师人格（融合批次 F1）：socratic / coach / minimal，缺省 general */
  persona?: string;
  /** 苏格拉底流程状态：guiding = 引导进行中；done = 已输出复盘（流程结束）；缺省 = 非苏格拉底流程 */
  socratic_state?: "guiding" | "done";
  /** 本条讲解含 diagram 图示代码块（G 批次），落库时检测 */
  has_diagram?: boolean;
}

export interface EvidenceRef {
  type: "message";
  id: string;
  conversation_id: string;
  slot: number;
}

export interface MessageDTO {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  slot_index: number;
  revision: number;
  status: MessageStatus;
  meta: MessageMeta | null;
  has_history: boolean;
  edited_from: string | null;
  created_at: string;
}

export interface ConversationDTO {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

export interface ProfileEntryDTO {
  id: string;
  concept_name: string;
  domain: string;
  mastery: number;
  source_type: "system" | "user";
  protected_until: string | null;
  last_touched_at: string;
  updated_at: string;
  evidence_refs: EvidenceRef[];
}

export interface ProfileLogDTO {
  id: string;
  concept_name: string;
  old_value: number | null;
  new_value: number | null;
  signal_type: string;
  detail: string | null;
  created_at: string;
}

export type NoteStatus = "draft" | "exported" | "source_deleted";

export interface NoteAnchor {
  id: string;
  conversation_id: string | null;
  slot: number;
}

export interface NoteDTO {
  id: string;
  title: string;
  content: string;
  anchors: NoteAnchor[];
  status: NoteStatus;
  version: number;
  domain: string;
  /** 用户手动设置过领域 → 自动归类不再覆盖 */
  domain_locked: boolean;
  conversation_id: string | null;
  source_conversation_id: string | null;
  source_title: string | null;
  created_at: string;
  updated_at: string;
}

export type SSEEvent =
  | {
      type: "meta";
      assistant_message_id: string;
      slot_index: number;
      depth: DepthLevel;
      concept_name: string | null;
      domain: string | null;
      profile_hit: boolean;
      used_entries: { name: string; mastery: number }[];
      missing_prereqs: { name: string; mastery: number }[];
      evidence: { slot: number; excerpt: string }[];
      feedback?: FeedbackKind;
      persona?: string;
    }
  | { type: "delta"; text: string }
  | { type: "notice"; message: string }
  | {
      type: "done";
      assistant_message_id: string;
      token_in: number;
      token_out: number;
      latency_ms: number;
      model: string;
      profile_updates: string[];
    }
  | { type: "error"; code: string; message: string; assistant_message_id?: string };

export interface DomainDist {
  domain: string;
  count: number;
}

export interface StatsDTO {
  week_conversations: number;
  total_conversations: number;
  /** 北极星（PRD 2.3，原型口径）：本周创建且已生成笔记的会话数 */
  week_closures: number;
  profile_entries: number;
  domain_distribution: DomainDist[];
  note_count: number;
  token_in: number;
  token_out: number;
  cost_estimate: number | null;
  /** 累计成本 ÷ 总会话数 */
  avg_session_cost: number | null;
}
