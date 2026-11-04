/* ============================================================
   api.js — 异步接口桩（Mock 服务层）
   约定：全部 async + delay()，签名与未来真实接口一致
   接入真实后端时逐个替换函数体，页面无需改动
   ============================================================ */
(function () {
  var DB = window.DB;

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * 把 Mock 中的 HTML 正文转成可读的 Markdown 文本。
   * 按块级标签补换行、按 li 补列表前缀，避免直接去标签后句子粘连。
   */
  function htmlToMarkdown(html) {
    if (!html) return "";
    return String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|blockquote|section|tr)>/gi, "\n")
      .replace(/<h([1-6])[^>]*>/gi, "\n### ")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "")
      .replace(/<\/ul>|<\/ol>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** 把「今天 / 昨天 / N 天前」的相对时间转成「距今分钟数」，值越大越早 */
  function updatedAtRank(label) {
    var text = String(label || "");
    var time = text.match(/(\d{1,2}):(\d{2})/);
    var minutes = time ? Number(time[1]) * 60 + Number(time[2]) : 0;
    if (text.indexOf("今天") === 0) return 1440 - minutes;
    if (text.indexOf("昨天") === 0) return 1440 + (1440 - minutes);
    var days = text.match(/(\d+)\s*天前/);
    if (days) return Number(days[1]) * 1440;
    return 999 * 1440;
  }


  /* GET /api/conversations → { code, data: Conversation[] } */
  function getConversations() {
    return delay(420).then(function () { return clone(DB.conversations); });
  }

  /* GET /api/conversations/:id/messages → { code, data: Message[] } */
  function getMessages(conversationId) {
    return delay(320).then(function () {
      return clone(DB.messages);
    });
  }

  /* POST /api/chat  (SSE → 此处用一次性 Promise 模拟)
     请求：{ conversation_id, content }
     响应：{ code, data: { depth, content, why, tokenUsed } } */
  function sendMessage(payload) {
    var text = (payload && payload.content ? payload.content : "").trim();
    return delay(900).then(function () {
      var reply =
        "<p>收到你的问题：<strong>" + text.replace(/[<>&]/g, "") + "</strong>。这是原型中的模拟讲解，用来演示判档与反馈交互，不会调用真实模型。</p>" +
        "<p>本段演示 L1 中等深度：先给结论，再补一条原理，最后留一个自检问题。</p>" +
        "<ul><li>结论：先把概念放回你已有的知识结构里</li><li>原理：用一句话解释「为什么」</li><li>自检：试着用自己的话说一遍，再点下方反馈</li></ul>" +
        "<p>点「没懂」会触发降档并写入画像，点「有帮助」会记录一次正确应用证据。</p>";
      return {
        id: "m-new-" + Date.now(),
        role: "assistant",
        depth: "L1",
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        feedback: null,
        content: reply,
        why: "<strong>为什么讲这么深？</strong><p>当前「" + text.slice(0, 12) + "」相关概念掌握度约 0.4，按阈值落在 L1 档：给结论 + 一条原理，不展开完整推导。</p>"
      };
    });
  }

  /* GET /api/notes?q=&domain=&sort= → { code, data: Note[] } */
  function getNotes(params) {
    var p = params || {};
    return delay(360).then(function () {
      var list = clone(DB.notes);
      if (p.domain && p.domain !== "全部") list = list.filter(function (n) { return n.domain === p.domain; });
      if (p.query) {
        var q = p.query.toLowerCase();
        list = list.filter(function (n) {
          return (n.title + n.excerpt + n.tags.join(" ") + n.concepts.join(" ")).toLowerCase().indexOf(q) > -1;
        });
      }
      if (p.sort === "oldest") list.sort(function (a, b) { return updatedAtRank(b.updatedAt) - updatedAtRank(a.updatedAt); });
      if (p.sort === "title") list.sort(function (a, b) { return a.title.localeCompare(b.title, "zh"); });
      return list;
    });
  }

  /* GET /api/notes/:id → { code, data: NoteDetail } */
  function getNote(id) {
    return delay(300).then(function () { return clone(DB.noteDetail); });
  }

  /* POST /api/selection/explain → { code, data: { answer, depth, isSummary } } */
  function explainSelection(text) {
    return delay(650).then(function () {
      return {
        depth: "L1",
        isSummary: text.length > 120,
        answer:
          "<p>「" + text.slice(0, 24).replace(/[<>&]/g, "") + "」在当前笔记语境中指：把位置信息注入 token 表示的一类方法，用于弥补自注意力的置换等变性。</p>" +
          "<p>它不改语义强度，只改变向量方向，因此与归一化的关系较弱、与注意力的点积形式关系更强。</p>"
      };
    });
  }

  /* POST /api/notes/:id/glossary → { code, data: GlossaryItem } */
  function addGlossary(payload) {
    return delay(300).then(function () {
      return { term: payload.term, def: payload.def, addedAt: "刚刚" };
    });
  }

  /* PATCH /api/profile/:conceptId → { code, data: { mastery } } */
  function updateMastery(payload) {
    return delay(320).then(function () {
      var base = 0.5;
      for (var i = 0; i < DB.concepts.length; i++) {
        if (DB.concepts[i].id === payload.conceptId) base = DB.concepts[i].mastery;
      }
      var next = Math.max(0, Math.min(1, base + Number(payload.delta || 0)));
      return { conceptId: payload.conceptId, mastery: next };
    });
  }

  /* POST /api/review/grade → { code, data: { nextInterval, nextDue } } */
  function gradeCard(payload) {
    return delay(260).then(function () {
      return {
        reviewId: payload.reviewId,
        grade: payload.grade,
        nextInterval: payload.grade === "known" ? 6 : 2,
        nextDue: payload.grade === "known" ? "6 天后" : "明天"
      };
    });
  }

  /* GET /api/review/queue → { code, data: ReviewItem[] } */
  function getReviewQueue() {
    return delay(340).then(function () { return clone(DB.reviewQueue); });
  }

  /* GET /api/stats → { code, data: Stats } */
  function getStats() {
    return delay(280).then(function () { return clone(DB.stats); });
  }

  /* POST /api/settings/llm/test → { code, message } */
  function testConnection(payload) {
    return delay(1100).then(function () {
      var ok = payload && payload.key && payload.key.length >= 8;
      if (!ok) throw new Error("API Key 长度不足，无法建立连接");
      return { ok: true, latency: 214, model: payload.model || "deepseek-chat" };
    });
  }

  /* PUT /api/settings/llm → { code, data: Settings } */
  function saveSettings(payload) {
    return delay(420).then(function () { return clone(payload); });
  }

  /* POST /api/notes/:id/export → { code, data: { filename, markdown } } */
  function exportNote(noteId) {
    var d = DB.noteDetail;
    return delay(380).then(function () {
      var md = "# " + d.title + "\n\n> 来源：" + d.sourceTitle + " · " + d.date + "\n\n";
      d.sections.forEach(function (s, i) {
        md += "## " + (i + 1) + ". " + s.h + "\n\n" + htmlToMarkdown(s.body) + "\n\n";
      });
      return { filename: d.title + "-" + d.date + ".md", markdown: md };
    });
  }

  window.api = {
    getConversations: getConversations,
    getMessages: getMessages,
    sendMessage: sendMessage,
    getNotes: getNotes,
    getNote: getNote,
    explainSelection: explainSelection,
    addGlossary: addGlossary,
    updateMastery: updateMastery,
    gradeCard: gradeCard,
    getReviewQueue: getReviewQueue,
    getStats: getStats,
    testConnection: testConnection,
    saveSettings: saveSettings,
    exportNote: exportNote,
    htmlToMarkdown: htmlToMarkdown
  };
})();
