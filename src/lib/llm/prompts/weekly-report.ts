export const WEEKLY_REPORT_PROMPT_VERSION = "reports-weekly-v1";

export interface WeeklyData {
  range: string;
  conversations: number;
  conceptsTouched: string[];
  masteryChanges: { name: string; from: number; to: number }[];
  weakest: { name: string; mastery: number }[];
  notesCreated: number;
  noteTitles: string[];
  reviewCount: number;
  selectionCount: number;
}

export function buildWeeklyReportMessages(data: WeeklyData) {
  return [
    {
      role: "system" as const,
      content: [
        "你是学习周报生成器。根据学习者本周的真实学习数据，生成一页叙事型学习周报。",
        "",
        "## 本周数据（JSON）",
        JSON.stringify(data),
        "",
        "## 输出结构（Markdown，严格遵守）",
        "# 学习周报（" + data.range + "）",
        "",
        "## 本周概览",
        "{用 2–3 句话概括本周学习：学了几块内容、产出几篇笔记、复习情况。数字必须来自上方数据，不要编造。}",
        "",
        "## 掌握度变化",
        "{有变化的概念逐条列出：「概念」从 X 升/降到 Y；没有变化就写「本周各概念掌握度保持稳定」。}",
        "",
        "## 薄弱点",
        "{最薄弱的 1–3 个概念，每个一句话说明为什么薄弱、建议怎么补。}",
        "",
        "## 下周建议",
        "{2–3 条具体可执行的建议（复习哪个、学哪个新概念、用什么方式），与本周数据呼应。}",
        "",
        "要求：语气平实鼓励，不堆砌数字；长度一页以内；只输出 Markdown。",
      ].join("\n"),
    },
  ];
}
