/** 导师人格（融合批次 F1）：前后端共享的展示定义 */
export const PERSONAS: { id: string; label: string; desc: string }[] = [
  { id: "general", label: "通用", desc: "默认风格：结构清晰、定义准确" },
  { id: "socratic", label: "苏格拉底式", desc: "先抛引导问题让你自己推，再给要点" },
  { id: "coach", label: "教练式", desc: "鼓励语气、类比丰富，结尾带小练习" },
  { id: "minimal", label: "极简式", desc: "要点化零寒暄，结论先行，长度减半" },
];

export function personaLabel(id?: string): string {
  if (!id || id === "general") return "通用";
  return PERSONAS.find((p) => p.id === id)?.label ?? id;
}
