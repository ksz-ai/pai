/* ============================================================
   assistant.js — PAI 智能助手（全局浮层 / Grok Bot 风格 Dock）
   职责：自然语言对话、流式渲染、快捷指令、上下文记忆
   依赖：icons.js（图标）、app.js（toast）、mock.js（本地数据）
   不改动任何既有页面逻辑，仅在各页追加引用
   ============================================================ */
(function () {
  "use strict";

  var STORE_MSG = "pai.assistant.messages.v1";
  var STORE_CTX = "pai.assistant.context.v1";
  var STORE_PAGE = "pai.assistant.page.v1";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name) { return '<span data-icon="' + name + '"></span>'; }
  function nowTime() {
    return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  function uid(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }
  function safeParse(key, fallback) {
    try {
      var raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }
  function safeSet(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 隐私模式忽略 */ }
  }
  function db() { return window.DB || {}; }
  function toast(message, kind) {
    if (window.ui && window.ui.toast) window.ui.toast(message, kind);
  }

  /* ---------------------------- 页面上下文 ---------------------------- */
  var PAGE_META = {
    home: { label: "学习概览", detail: "今日学习概览", hint: "我可以带你看今天该做什么" },
    chat: { label: "对话讲解", detail: "位置编码会话", hint: "可以接着当前会话继续追问" },
    notes: { label: "笔记库", detail: "结构化笔记", hint: "可以按关键词或领域找笔记" },
    note: { label: "笔记阅读", detail: "笔记正文", hint: "可以解释正文里的概念" },
    profile: { label: "学习画像", detail: "掌握度追踪", hint: "可以分析你最弱的概念" },
    review: { label: "复习队列", detail: "间隔重复排期", hint: "我可以陪你过一遍到期概念" },
    settings: { label: "设置", detail: "AI 服务配置", hint: "可以帮你理解每个配置项" }
  };

  function currentPageKey() {
    var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    file = file.replace(".html", "");
    if (!file || file === "index") return "home";
    return PAGE_META[file] ? file : "home";
  }

  function metaFor(key) {
    var base = PAGE_META[key] || { label: "当前页面", detail: "", hint: "有问题随时问我" };
    var d = db();
    var out = { key: key, label: base.label, detail: base.detail, hint: base.hint };
    if (key === "home" && d.stats) {
      var minutes = (d.stats.weeklyMinutes || []).reduce(function (a, b) { return a + b; }, 0);
      out.detail = "今日 " + (d.stats.reviewDue || 0) + " 个概念待复习 · 本周 " + (minutes / 60).toFixed(1) + " 小时";
    }
    if (key === "notes" && d.notes) out.detail = d.notes.length + " 篇结构化笔记";
    if (key === "note" && d.noteDetail) out.detail = "《" + d.noteDetail.title + "》";
    if (key === "profile" && d.concepts) out.detail = d.concepts.length + " 个已建档概念";
    if (key === "review" && d.reviewQueue) {
      out.detail = "今日 " + d.reviewQueue.filter(function (r) { return r.due === "今天"; }).length + " 个到期";
    }
    if (key === "settings" && d.settings) out.detail = d.settings.provider + " · " + d.settings.model;
    return out;
  }

  /* ---------------------------- 快捷指令 ---------------------------- */
  var COMMANDS = [
    { key: "explain", label: "解释当前页面", desc: "基于当前页上下文讲核心概念", icon: "lightbulb", prompt: "解释一下当前页面的核心概念" },
    { key: "quiz", label: "生成 3 道自检题", desc: "从笔记卡片或画像出题", icon: "circle-help", prompt: "就当前内容给我 3 道自检题" },
    { key: "summary", label: "一句话总结", desc: "把本页压缩成一句话", icon: "zap", prompt: "用一句话总结当前页面" },
    { key: "review", label: "查看今日待复习", desc: "列出到期概念与来源", icon: "rotate-ccw", prompt: "今天有哪些概念到期需要复习？" },
    { key: "compare", label: "RoPE vs 正弦编码", desc: "对比两种位置编码路线", icon: "git-branch", prompt: "对比 RoPE 和正弦编码的差异" },
    { key: "profile", label: "我最弱的概念", desc: "按掌握度排序的最低项", icon: "fingerprint", prompt: "我目前掌握度最低的概念是什么？" },
    { key: "plan", label: "生成 20 分钟计划", desc: "结合画像安排一次短学习", icon: "target", prompt: "根据我的画像，安排明天 20 分钟的学习计划" },
    { key: "notes", label: "找相关笔记", desc: "列出置顶与最近笔记", icon: "book-open", prompt: "有哪些相关笔记可以读？" },
    { key: "help", label: "查看全部指令", desc: "列出所有斜杠指令", icon: "list", prompt: "/help" }
  ];

  function findCommand(key) {
    for (var i = 0; i < COMMANDS.length; i++) if (COMMANDS[i].key === key) return COMMANDS[i];
    return null;
  }

  /* ---------------------------- 状态 ---------------------------- */
  var state = {
    open: false,
    busy: false,
    messages: [],
    context: [],
    timer: null,
    pending: null,
    typingEl: null,
    streaming: null,
    paletteOpen: false,
    paletteIndex: 0,
    paletteItems: []
  };

  var refs = {};

  /* ---------------------------- 注入 DOM ---------------------------- */
  function inject() {
    var root = document.createElement("div");
    root.className = "pa-root";
    root.innerHTML = [
      '<button class="pa-launcher" id="pa-launcher" type="button" aria-expanded="false" aria-controls="pa-panel" aria-label="打开 PAI 智能助手">',
        '<span class="pa-launcher__mark" aria-hidden="true">', icon("sparkles"), '<span class="pa-launcher__dot"></span></span>',
        '<span class="pa-launcher__text">智能助手</span>',
      '</button>',
      '<section class="pa-panel" id="pa-panel" hidden aria-label="PAI 智能助手">',
        '<header class="pa-head">',
          '<div class="pa-head__id">',
            '<span class="pa-bot" aria-hidden="true">', icon("sparkles"), '</span>',
            '<div><strong>PAI 助手</strong><small><i class="pa-status-dot" id="pa-status-dot"></i><span id="pa-status">在线 · 本地引擎</span></small></div>',
          '</div>',
          '<div class="pa-head__tools">',
            '<button class="pa-icon" type="button" data-pa-new aria-label="开始新对话" title="开始新对话">', icon("plus"), '</button>',
            '<button class="pa-icon" type="button" data-pa-close aria-label="收起助手" title="收起（Esc）">', icon("x"), '</button>',
          '</div>',
        '</header>',
        '<div class="pa-context" aria-label="上下文记忆">',
          '<div class="pa-context__head"><span>', icon("brain"), '上下文记忆</span><span id="pa-context-count">1 项</span></div>',
          '<div class="pa-context__chips" id="pa-context-chips"></div>',
        '</div>',
        '<div class="pa-stream" id="pa-stream" role="log" aria-live="off" aria-label="对话记录"></div>',
        '<div class="pa-quick">',
          '<div class="pa-quick__head"><span>快捷指令</span><button type="button" data-pa-palette>全部指令 <span class="kbd">/</span></button></div>',
          '<div class="pa-quick__chips" id="pa-quick-chips"></div>',
        '</div>',
        '<form class="pa-composer" id="pa-form">',
          '<div class="pa-composer__box">',
            '<textarea id="pa-input" rows="1" placeholder="问点什么，或输入 / 查看指令…" aria-label="给 PAI 助手发消息"></textarea>',
            '<button class="pa-send" id="pa-send" type="submit" disabled aria-label="发送">', icon("send"), '</button>',
          '</div>',
          '<div class="pa-composer__foot"><span><span class="kbd">Enter</span> 发送 · <span class="kbd">Shift+Enter</span> 换行</span><span id="pa-foot-hint">上下文已同步</span></div>',
        '</form>',
        '<div class="pa-palette" id="pa-palette" hidden role="listbox" aria-label="指令面板"></div>',
      '</section>'
    ].join("");
    document.body.appendChild(root);

    refs.root = root;
    refs.launcher = $("#pa-launcher", root);
    refs.panel = $("#pa-panel", root);
    refs.statusDot = $("#pa-status-dot", root);
    refs.status = $("#pa-status", root);
    refs.contextChips = $("#pa-context-chips", root);
    refs.contextCount = $("#pa-context-count", root);
    refs.stream = $("#pa-stream", root);
    refs.quick = $("#pa-quick-chips", root);
    refs.form = $("#pa-form", root);
    refs.input = $("#pa-input", root);
    refs.sendBtn = $("#pa-send", root);
    refs.palette = $("#pa-palette", root);
    if (window.renderIcons) window.renderIcons(root);
  }

  /* ---------------------------- 轻量 Markdown ---------------------------- */
  function inlineFmt(raw) {
    var s = esc(raw);
    s = s.replace(/`([^`]+)`/g, '<code class="pa-code">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }

  function renderLite(text) {
    var lines = String(text || "").split("\n");
    var out = [];
    var para = [];
    var listType = null;

    function flushPara() {
      if (para.length) { out.push("<p>" + inlineFmt(para.join(" ")) + "</p>"); para = []; }
    }
    function flushList() {
      if (listType) { out.push("</" + listType + ">"); listType = null; }
    }

    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) { flushPara(); flushList(); return; }
      var ul = t.match(/^[-•]\s+(.*)$/);
      var ol = t.match(/^\d+\.\s+(.*)$/);
      var head = t.match(/^(#{1,3})\s+(.*)$/);
      var quote = t.match(/^>\s?(.*)$/);
      if (ul || ol) {
        flushPara();
        var want = ul ? "ul" : "ol";
        if (listType !== want) { flushList(); out.push("<" + want + ">"); listType = want; }
        out.push("<li>" + inlineFmt(ul ? ul[1] : ol[1]) + "</li>");
        return;
      }
      flushList();
      if (head) { flushPara(); out.push('<div class="pa-h">' + inlineFmt(head[2]) + "</div>"); return; }
      if (quote) { flushPara(); out.push('<div class="pa-quote">' + inlineFmt(quote[1]) + "</div>"); return; }
      para.push(t);
    });
    flushPara();
    flushList();
    return out.join("");
  }

  /* ---------------------------- 消息渲染 ---------------------------- */
  function footInner(m) {
    var refsHtml = "";
    if (m.refs && m.refs.length) {
      refsHtml =
        '<div class="pa-msg__refs">' + icon("brain") + "<span>引用</span>" +
          m.refs.map(function (r) { return '<span class="pa-ref">' + esc(r) + "</span>"; }).join("") +
        "</div>";
    }
    return refsHtml +
      '<div class="pa-msg__actions">' +
        '<button class="pa-mini-btn" type="button" data-pa-copy>' + icon("copy") + "复制</button>" +
        '<button class="pa-mini-btn" type="button" data-pa-retry>' + icon("refresh-cw") + "重新生成</button>" +
      "</div>";
  }

  function messageHTML(m) {
    if (m.role === "system") {
      return '<article class="pa-msg pa-msg--system">' +
        '<span class="pa-sysline">' + icon("info") + esc(m.text) + "</span></article>";
    }
    if (m.role === "user") {
      return '<article class="pa-msg pa-msg--user" data-id="' + m.id + '">' +
        '<div class="pa-msg__role"><strong>你</strong><span class="pa-msg__time">' + esc(m.time || "") + "</span></div>" +
        '<div class="pa-msg__body">' + esc(m.text) + "</div>" +
      "</article>";
    }
    return '<article class="pa-msg pa-msg--assistant" data-id="' + m.id + '">' +
      '<div class="pa-msg__role"><span class="pa-msg__avatar">AI</span><strong>PAI 助手</strong><span class="pa-msg__time">' + esc(m.time || "") + "</span></div>" +
      '<div class="pa-msg__body">' + renderLite(m.text) + "</div>" +
      '<div class="pa-msg__foot">' + footInner(m) + "</div>" +
    "</article>";
  }

  function appendMessage(m) {
    var wrap = document.createElement("div");
    wrap.innerHTML = messageHTML(m);
    var el = wrap.firstElementChild;
    refs.stream.appendChild(el);
    if (window.renderIcons) window.renderIcons(el);
    return el;
  }

  function renderStream() {
    refs.stream.innerHTML = state.messages.map(messageHTML).join("");
    if (window.renderIcons) window.renderIcons(refs.stream);
    scrollBottom(true);
  }

  function scrollBottom(force) {
    if (!refs.stream) return;
    var el = refs.stream;
    var near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (force || near) el.scrollTop = el.scrollHeight;
  }

  /* ---------------------------- 上下文记忆 ---------------------------- */
  function pageRefLabel(meta) { return "本页 · " + meta.label; }

  function trimContext() {
    var page = state.context.filter(function (c) { return c.kind === "page"; }).slice(0, 1);
    var rest = state.context.filter(function (c) { return c.kind !== "page"; });
    state.context = page.concat(rest.slice(-4));
  }

  function ensurePageChip(meta) {
    state.context = state.context.filter(function (c) { return c.kind !== "page"; });
    state.context.unshift({ id: "page", kind: "page", label: meta.label });
    trimContext();
  }

  function persistContext() { safeSet(STORE_CTX, state.context); }

  function renderContext() {
    refs.contextChips.innerHTML = state.context.map(function (c) {
      var removable = c.kind !== "page";
      return '<span class="pa-cchip pa-cchip--' + c.kind + '" title="' + esc(c.label) + '">' +
        "<span>" + esc(c.label) + "</span>" +
        (removable
          ? '<button type="button" data-pa-unset="' + c.id + '" aria-label="从上下文移除 ' + esc(c.label) + '">' + icon("x") + "</button>"
          : "") +
      "</span>";
    }).join("");
    refs.contextCount.textContent = state.context.length + " 项";
    if (window.renderIcons) window.renderIcons(refs.contextChips);
  }

  function remember(text) {
    var d = db();
    var found = [];
    (d.concepts || []).forEach(function (k) {
      if (text.indexOf(k.name) > -1 && found.indexOf(k.name) < 0) found.push(k.name);
    });
    if (found.length) {
      state.context = state.context.filter(function (c) { return c.kind !== "topic"; });
      found.forEach(function (name) {
        state.context = state.context.filter(function (c) {
          return !(c.kind === "concept" && c.label === name);
        });
        state.context.push({ id: "concept:" + name, kind: "concept", label: name });
      });
    } else {
      var isContinue = /^(继续|接着|往下|再讲)/.test(text.replace(/\s+/g, "").trim());
      var topic = text.replace(/[`*#>]/g, "").replace(/\s+/g, " ").trim();
      if (isContinue) {
        topic = topic.replace(/^(继续|接着|往下|再讲|讲|说说|一下)(讲|说|聊)?/, "").trim();
      }
      var keepOldTopic = isContinue && (topic === "" || /^(刚才|之前|上一|这个|那个)/.test(topic));
      if (!keepOldTopic && topic) {
        state.context = state.context.filter(function (c) { return c.kind !== "topic"; });
        state.context.push({ id: "topic", kind: "topic", label: "话题 · " + topic.slice(0, 12) });
      }
    }
    trimContext();
    renderContext();
    persistContext();
  }

  function contextRefs() {
    var labels = [];
    state.context.forEach(function (c) {
      var label = c.kind === "page" ? pageRefLabel({ label: c.label }) : c.label;
      if (labels.indexOf(label) < 0) labels.push(label);
    });
    return labels.slice(0, 3);
  }

  /* ---------------------------- 本地回复引擎 ---------------------------- */
  function pct(v) { return Math.round((v || 0) * 100); }

  function noteById(id) {
    var list = db().notes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function dueItems() {
    return (db().reviewQueue || []).filter(function (r) { return r.due === "今天"; });
  }

  function weakestConcepts(n) {
    return (db().concepts || []).slice().sort(function (a, b) { return a.mastery - b.mastery; }).slice(0, n);
  }

  function findConceptInText(text) {
    var list = db().concepts || [];
    for (var i = 0; i < list.length; i++) if (text.indexOf(list[i].name) > -1) return list[i];
    return null;
  }

  function cleanEcho(text) {
    return text.replace(/[`*#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function helpText() {
    return [
      "我是 **PAI 助手**，可以直接聊天，也可以用指令快速开始。当前上下文会随页面更新，并在同一次浏览会话里保留。",
      "",
      "**斜杠指令**",
      "- `/explain` 解释当前页面的核心概念",
      "- `/quiz` 生成 3 道自检题",
      "- `/summary` 一句话总结当前页面",
      "- `/review` 查看今日待复习",
      "- `/compare` 对比 RoPE 与正弦编码",
      "- `/profile` 我最弱的概念",
      "- `/plan` 生成 20 分钟学习计划",
      "- `/notes` 找相关笔记",
      "- `/help` 查看这份说明",
      "",
      "也可以直接说人话，例如「帮我出三道题」或「继续刚才的话题」。"
    ].join("\n");
  }

  function greetingText(meta) {
    var count = state.context.length;
    return "在的。我记着你在「**" + meta.label + "**」，上下文里有 " + count + " 项记忆。\n\n" +
      "今天可以做这些：\n" +
      "- 解释当前页面的核心概念\n" +
      "- 出 3 道自检题\n" +
      "- 查看今日待复习\n\n" +
      "需要我从哪一件开始？";
  }

  function reviewText(meta) {
    var items = dueItems();
    if (!items.length) {
      return "今天没有到期概念，队列是空的。\n\n建议去笔记库生成一张新卡片，或者继续「" + meta.label + "」。\n\n[去笔记库](notes.html)";
    }
    var lines = items.map(function (r) {
      var note = noteById(r.noteId);
      return "- **" + r.concept + "** · 来源《" + (note ? note.title : "对应笔记") + "》· 间隔 " + r.interval + " 天";
    }).join("\n");
    var weak = weakestConcepts(1)[0];
    var advice = weak ? "\n\n建议先从掌握度最低的 **" + weak.name + "**（" + pct(weak.mastery) + "%）开始。" : "";
    return "今天有 **" + items.length + " 个概念**到期，当前停在「" + meta.label + "」：\n\n" + lines + advice +
      "\n\n[去复习队列](review.html)";
  }

  function weakText() {
    var list = weakestConcepts(3);
    var lines = list.map(function (k, i) {
      return (i + 1) + ". **" + k.name + "** · " + k.domain + " · 掌握度 " + pct(k.mastery) + "%";
    }).join("\n");
    return "按当前画像，最弱的 " + list.length + " 个概念是：\n\n" + lines +
      "\n\n低于 30% 的概念会优先进入复习队列。要我针对「" + list[0].name + "」出一组自检题吗？\n\n[查看学习画像](profile.html)";
  }

  function planText() {
    var weak = weakestConcepts(2);
    var first = weak[0] ? weak[0].name : "位置编码";
    var firstPct = weak[0] ? pct(weak[0].mastery) : 34;
    var second = weak[1] ? weak[1].name : "RoPE";
    return [
      "按你的画像，明天 20 分钟可以这样安排：",
      "",
      "1. **6 分钟** · 复习「" + first + "」（" + firstPct + "%）——先复述定义，再举一个反例",
      "2. **8 分钟** · 继续位置编码会话，补完「相对位置被点积表达」这一步",
      "3. **6 分钟** · 用自检题验证「" + second + "」，答不上就加入复习队列",
      "",
      "需要我把它拆成待办，或直接开始复习吗？\n\n[打开复习队列](review.html)"
    ].join("\n");
  }

  function compareText() {
    return [
      "**一句话结论**：正弦编码「加在输入上」，RoPE「旋转在注意力里」。",
      "",
      "**正弦编码（绝对位置）**",
      "- 给每个位置生成不同频率的 sin / cos，与 token embedding 相加",
      "- 能提供位置线索，但距离需要模型间接推断，长序列外推较弱",
      "",
      "**RoPE（相对位置）**",
      "- 对 q / k 的成对维度做旋转，旋转角由位置决定",
      "- 点积只依赖相对位移 `i − j`，且不改变向量模长",
      "- 因此相对性被写进了运算结构，而不是事后学习",
      "",
      "> 代价：RoPE 需要额外的旋转实现；超长序列仍要靠插值或频率缩放。",
      "",
      "要我用「指针类比」再讲一遍旋转为什么不破坏语义吗？"
    ].join("\n");
  }

  function quizText() {
    var cards = ((db().noteDetail || {}).cards || []).slice(0, 3);
    var qs;
    if (cards.length >= 3) {
      qs = cards.map(function (c) { return c.front; });
    } else {
      var weak = weakestConcepts(3);
      qs = [
        "用自己的话解释「" + (weak[0] ? weak[0].name : "位置编码") + "」",
        "它与「" + (weak[1] ? weak[1].name : "自注意力") + "」是什么关系？",
        "举一个它会失效、或需要额外处理的反例"
      ];
    }
    return "给你 **3 道自检题**（先自己答，再对照笔记）：\n\n" +
      qs.map(function (q, i) { return (i + 1) + ". " + q; }).join("\n") +
      "\n\n答不上来的题会进入复习队列。需要我逐题讲一遍，直接说「讲第一题」。";
  }

  function positionText() {
    return [
      "**一句话**：自注意力负责「谁和谁相关」，位置编码负责「谁先谁后」。",
      "",
      "把注意力想成一次加权求和：权重只由 q、k 的相似度决定。输入顺序打乱，权重矩阵只会被同时置换，输出集合不变——这就是**置换等变性**。",
      "",
      "补上顺序有两条路线：",
      "- **正弦编码**：把 sin / cos 按不同频率生成位置向量，**加**在 token embedding 上，属于绝对位置",
      "- **RoPE**：按位置角度**旋转** q / k 的成对维度，点积结果只依赖相对位移 `i − j`，且不改变向量模长",
      "",
      "> 当前笔记《位置编码：从正弦到 RoPE》的「直觉类比」一节，用指针的夹角解释了为什么旋转不会破坏语义。",
      "",
      "要不要我接着讲「为什么相对位置能被点积表达」？"
    ].join("\n");
  }

  function continuationText() {
    return [
      "接着上一轮往下走，把「相对位置」拆成三步：",
      "",
      "1. 每个 q / k 按自己的位置旋转一个角度，旋转不改变模长，所以语义强度不变",
      "2. 两个 token 做点积时，夹角差等于它们的角度差，也就是相对位移 `i − j`",
      "3. 因此模型不必知道绝对位置，只需要知道「彼此差多远」",
      "",
      "> 如果这一步还抽象，可以回到笔记里的指针类比；想继续到长序列外推，我也可以接着讲插值与频率缩放。"
    ].join("\n");
  }

  function conceptText(k) {
    var ev = k.evidence && k.evidence[0];
    return [
      "「**" + k.name + "**」在你的画像里掌握度 **" + pct(k.mastery) + "%**（" + k.domain + "），属于需要巩固的区间。",
      "",
      "- 最近证据：" + (ev ? "《原对话 · " + ev.at + "》「" + ev.quote.slice(0, 26) + "…」" : "暂无记录"),
      "- 记录更新：" + (k.updatedAt || "近期"),
      "- 保护状态：" + (k.protected ? "手动纠错保护期内，系统不会下调" : "未进入保护期"),
      "",
      "建议先用自己的话复述定义，再举一个反例。要我针对「" + k.name + "」出一题吗？"
    ].join("\n");
  }

  function pageExplainText(meta) {
    if (meta.key === "profile") {
      return [
        "**学习画像**把三类信号累计成 0–1 的掌握度：",
        "- **提问**：首次提问建立条目，初始值 0.3",
        "- **反馈**：有帮助 +0.15，没懂 −0.15，单轮最多记一次负向",
        "- **手动纠错**：优先级最高，并且锁 30 天保护期",
        "",
        "讲解深度由掌握度阈值决定：低于 0.3 用 L0 单一类比，0.3–0.7 用 L1 结论加原理，高于 0.7 才展开到 L2。",
        "",
        "你想看哪个概念的证据？我可以按掌握度最低的顺序列出来。"
      ].join("\n");
    }
    if (meta.key === "review") {
      return [
        "**复习队列**按间隔重复排期：",
        "- 「认识了」：间隔 ×1.5，当前 4 天，下一次约 6 天后",
        "- 「还不熟」：间隔回到 2 天，明天优先出现",
        "",
        "每次自评都会回流画像：认识记一次应用证据，不熟记一次负向信号。今天有 " + dueItems().length + " 个概念到期。",
        "",
        "需要我先列出今天的到期项吗？"
      ].join("\n");
    }
    if (meta.key === "notes") {
      return [
        "**笔记库**是对话的结构化沉淀：每篇笔记由六节组成，并把原对话里的关键句保留成 a1–a3 锚点。",
        "",
        "- 搜索会匹配标题、摘要、标签与概念",
        "- 领域筛选与排序只影响展示，不会改动原文",
        "- 批量合并会生成一篇可溯源的总纲，原笔记保留",
        "",
        "要我先列出置顶笔记，还是按领域筛一批？"
      ].join("\n");
    }
    if (meta.key === "settings") {
      var s = db().settings || {};
      return [
        "当前设置：**" + (s.provider || "DeepSeek") + " · " + (s.model || "deepseek-chat") + "**，单会话预算 " + (s.budget || 32000).toLocaleString("en-US") + " tokens。",
        "",
        "- **服务商**决定可用模型与端点，切换后模型下拉会同步",
        "- **导师人格**影响提问方式与讲解结构",
        "- **自动压缩**在达到 80% 预算时保留结论与证据",
        "",
        "这些配置只影响下一次对话，保存即生效。"
      ].join("\n");
    }
    if (meta.key === "home") {
      return [
        "今天的重点有两条：",
        "- 先清掉 **" + dueItems().length + " 个到期概念**，预计 8 分钟",
        "- 再继续「为什么 Transformer 需要位置编码」的会话，补完相对位置那一步",
        "",
        "想先做哪一个？我可以直接带你进入复习队列，或者出三道题热热身。"
      ].join("\n");
    }
    return "可以把当前页面理解成学习闭环里的一个环节：概览定计划、对话做理解、笔记做沉淀、画像做校准、复习做巩固。\n\n告诉我你具体想弄懂哪一部分，我再展开。";
  }

  function notesText() {
    var notes = (db().notes || []).slice();
    notes.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
    var lines = notes.slice(0, 3).map(function (n) {
      return "- 《" + n.title + "》 · " + n.domain + " · " + n.updatedAt + (n.pinned ? " · 置顶" : "");
    }).join("\n");
    return "与你当前上下文相关的笔记：\n\n" + lines +
      "\n\n[打开笔记库](notes.html) · [阅读位置编码笔记](note.html)";
  }

  function summaryText(meta) {
    if (meta.key === "note" || meta.key === "chat") {
      return "**一句话**：位置编码不是附加信息，而是让自注意力具备「顺序感」的那部分结构。\n\n正弦编码把位置**加**在输入上，RoPE 把位置**旋转**进 q·k 点积——前者是绝对位置，后者天然表达相对位置。";
    }
    if (meta.key === "profile") return "**一句话**：学习画像把提问、反馈与纠错累计成 0–1 掌握度，并让讲解深度随之调整。";
    if (meta.key === "review") return "**一句话**：按间隔重复排期，先把最弱的概念在今天过一遍。";
    if (meta.key === "notes") return "**一句话**：每篇笔记都是对话的结构化沉淀，锚点可以回到原句。";
    if (meta.key === "settings") return "**一句话**：服务商、模型、人格与预算，决定下一次讲解的形态。";
    if (meta.key === "home") return "**一句话**：今天优先把 " + dueItems().length + " 个到期概念过完，再继续位置编码会话。";
    return "**一句话**：把当前页面看成学习闭环的一环，先明确它解决的问题，再回到你的画像里校准。";
  }

  function defaultText(text, meta) {
    var echo = cleanEcho(text);
    var topic = null;
    state.context.forEach(function (c) { if (c.kind === "topic") topic = c.label.replace("话题 · ", ""); });
    var carry = topic ? "我沿用上下文里的「" + topic + "」继续。" : "";
    return "我把你的问题记进上下文了：**" + echo + "**。\n\n" + carry + "在「" + meta.label + "」页面里，建议先确认三件事：\n" +
      "- 它解决什么问题\n" +
      "- 它与已有概念的关系\n" +
      "- 有没有一个可验证的例子\n\n" +
      "你也可以让我「解释当前页面」「出三道题」或「查看今日待复习」，我会按上下文接着讲。";
  }

  function explainText(text, meta) {
    if (/位置编码|正弦|rope|旋转位置|注意力|transformer/i.test(text) || meta.key === "note" || meta.key === "chat") {
      return positionText();
    }
    var hit = findConceptInText(text);
    if (hit) return conceptText(hit);
    return pageExplainText(meta);
  }

  function composeReply(rawText) {
    var meta = metaFor(currentPageKey());
    var text = String(rawText || "");
    var q = text.toLowerCase();
    var refs = contextRefs();

    var slash = q.match(/^\/\s*([a-z-]+)\s*$/);
    if (slash) {
      var cmd = findCommand(slash[1]);
      if (cmd) { text = cmd.prompt; q = text.toLowerCase(); }
      else { return { text: "没有找到指令 `/" + slash[1] + "`。\n\n" + helpText(), refs: refs }; }
    }

    if (/^(你好|您好|hi|hello|在吗|嗨)/.test(q)) return { text: greetingText(meta), refs: refs };
    if (q.indexOf("/help") === 0 || /能做什么|怎么用|帮助|指令/.test(text)) return { text: helpText(), refs: refs };
    if (/复习|到期|待复习|review/.test(q)) return { text: reviewText(meta), refs: refs };
    if (/最弱|薄弱|弱项|掌握度最低/.test(text)) return { text: weakText(), refs: refs };
    if (/计划|安排|明天|怎么学|学习节奏/.test(text)) return { text: planText(), refs: refs };
    if (/对比|区别|差异|比较|vs/.test(q) && /rope|正弦|位置编码|alibi/.test(q)) return { text: compareText(), refs: refs };
    if (/题|测验|自检|quiz|考考/.test(text)) return { text: quizText(), refs: refs };
    if (/总结|一句话|概括/.test(text)) return { text: summaryText(meta), refs: refs };
    if (/继续|接着|往下|再讲/.test(text) && (meta.key === "note" || meta.key === "chat")) {
      return { text: continuationText(), refs: refs };
    }
    if (/笔记|note/.test(q)) return { text: notesText(), refs: refs };
    if (/解释|讲解|什么意思|原理|为什么|是什么/.test(text)) return { text: explainText(text, meta), refs: refs };
    return { text: defaultText(text, meta), refs: refs };
  }

  /* ---------------------------- 会话流程 ---------------------------- */
  function persistMessages() {
    var list = state.messages.filter(function (m) { return m.role === "user" || m.role === "assistant"; });
    safeSet(STORE_MSG, list.slice(-16));
  }

  function welcomeMessage(meta) {
    return {
      id: uid("a"),
      role: "assistant",
      time: nowTime(),
      refs: [pageRefLabel(meta)],
      text: "你好，林致远。我是 **PAI 助手**，已同步「" + meta.label + "」的上下文。\n\n" +
        meta.hint + "。你可以直接说人话，也可以点下面的快捷指令。\n\n" +
        "> 原型演示：回答由本地规则引擎生成，不会调用真实模型。"
    };
  }

  function setBusy(busy) {
    state.busy = busy;
    refs.statusDot.classList.toggle("is-busy", busy);
    refs.status.textContent = busy ? "正在生成…" : "在线 · 本地引擎";
    refs.stream.setAttribute("aria-busy", busy ? "true" : "false");
    syncSend();
  }

  function syncSend() {
    if (!refs.sendBtn) return;
    if (state.busy) {
      refs.sendBtn.disabled = false;
      refs.sendBtn.classList.add("is-stop");
      refs.sendBtn.setAttribute("aria-label", "停止生成");
      refs.sendBtn.innerHTML = icon("x");
    } else {
      refs.sendBtn.classList.remove("is-stop");
      refs.sendBtn.disabled = !refs.input.value.trim();
      refs.sendBtn.setAttribute("aria-label", "发送");
      refs.sendBtn.innerHTML = icon("send");
    }
    if (window.renderIcons) window.renderIcons(refs.sendBtn);
  }

  function autoGrow() {
    refs.input.style.height = "auto";
    refs.input.style.height = Math.min(refs.input.scrollHeight, 96) + "px";
  }

  function appendTyping() {
    var el = document.createElement("article");
    el.className = "pa-msg pa-msg--assistant";
    el.innerHTML =
      '<div class="pa-msg__role"><span class="pa-msg__avatar">AI</span><strong>PAI 助手</strong><span class="pa-msg__time">正在思考</span></div>' +
      '<div class="pa-typing"><i></i><i></i><i></i></div>';
    refs.stream.appendChild(el);
    scrollBottom(true);
    return el;
  }

  function startStream(reply) {
    var m = { id: uid("a"), role: "assistant", time: nowTime(), text: "", refs: reply.refs || [] };
    state.messages.push(m);
    var el = appendMessage(m);
    el.classList.add("is-streaming");
    var body = el.querySelector(".pa-msg__body");
    body.innerHTML = '<span class="pa-caret"></span>';

    var full = reply.text || "";
    var i = 0;
    state.streaming = { m: m, el: el, body: body, full: full, partial: "" };

    state.timer = setInterval(function () {
      i += 3;
      if (i > full.length) i = full.length;
      var partial = full.slice(0, i);
      state.streaming.partial = partial;
      m.text = partial;
      body.innerHTML = renderLite(partial) + '<span class="pa-caret"></span>';
      scrollBottom(false);
      if (i >= full.length) finishStreaming(false);
    }, 18);
  }

  function finishStreaming(stopped) {
    var s = state.streaming;
    if (!s) return;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    var full = stopped ? s.partial : s.full;

    if (stopped && !full.trim()) {
      s.el.remove();
      state.messages = state.messages.filter(function (m) { return m.id !== s.m.id; });
    } else {
      s.m.text = full;
      s.el.classList.remove("is-streaming");
      s.body.innerHTML = renderLite(full);
      var foot = s.el.querySelector(".pa-msg__foot");
      if (foot) {
        foot.innerHTML = footInner(s.m);
        if (window.renderIcons) window.renderIcons(foot);
      }
    }

    state.streaming = null;
    setBusy(false);
    persistMessages();
    scrollBottom(false);
  }

  function stopAll() {
    if (state.pending) {
      clearTimeout(state.pending);
      state.pending = null;
    }
    if (state.typingEl && state.typingEl.parentNode) {
      state.typingEl.remove();
      state.typingEl = null;
    }
    if (state.streaming || state.timer) finishStreaming(true);
    else setBusy(false);
  }

  function respond(text) {
    stopTypingOnly();
    setBusy(true);
    state.typingEl = appendTyping();
    state.pending = setTimeout(function () {
      state.pending = null;
      if (state.typingEl && state.typingEl.parentNode) state.typingEl.remove();
      state.typingEl = null;
      var reply;
      try {
        reply = composeReply(text);
      } catch (err) {
        reply = { text: "刚才这条我没能整理好，你可以换个说法再问一次。", refs: [] };
      }
      startStream(reply);
    }, 520);
  }

  function stopTypingOnly() {
    if (state.pending) { clearTimeout(state.pending); state.pending = null; }
    if (state.typingEl && state.typingEl.parentNode) state.typingEl.remove();
    state.typingEl = null;
  }

  function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (state.busy) { toast("正在生成，请稍候", "warn"); return; }
    openPanel();
    remember(text);
    closePalette();
    var m = { id: uid("u"), role: "user", text: text, time: nowTime() };
    state.messages.push(m);
    appendMessage(m);
    refs.input.value = "";
    autoGrow();
    syncSend();
    scrollBottom(true);
    persistMessages();
    respond(text);
  }

  function newChat() {
    if (state.busy) stopAll();
    var meta = metaFor(currentPageKey());
    state.messages = [];
    state.context = state.context.filter(function (c) { return c.kind === "page"; });
    ensurePageChip(meta);
    state.messages.push(welcomeMessage(meta));
    persistContext();
    persistMessages();
    renderStream();
    renderContext();
    setBusy(false);
    if (window.ui) window.ui.toast("已开始新对话，上下文已重置");
  }

  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        if (window.ui) window.ui.toast("回答已复制");
      } catch (err) {
        if (window.ui) window.ui.toast("复制失败，请手动选择", "warn");
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (window.ui) window.ui.toast("回答已复制");
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  function retryMessage(el) {
    if (state.busy) { toast("正在生成，请稍候", "warn"); return; }
    var id = el.getAttribute("data-id");
    var idx = -1;
    state.messages.forEach(function (m, i) { if (m.id === id) idx = i; });
    if (idx < 0) return;
    var userText = null;
    for (var j = idx - 1; j >= 0; j--) {
      if (state.messages[j].role === "user") { userText = state.messages[j].text; break; }
    }
    if (!userText) { toast("这条回答前没有问题可重试", "warn"); return; }
    state.messages.splice(idx, 1);
    el.remove();
    persistMessages();
    respond(userText);
    toast("正在重新生成…");
  }

  /* ---------------------------- 面板开关 ---------------------------- */
  function openPanel() {
    if (state.open) return;
    state.open = true;
    refs.panel.hidden = false;
    refs.launcher.classList.add("is-open");
    refs.launcher.setAttribute("aria-expanded", "true");
    if (window.innerWidth <= 560) document.body.classList.add("pa-lock");
    if (window.renderIcons) window.renderIcons(refs.panel);
    scrollBottom(true);
    setTimeout(function () { refs.input.focus({ preventScroll: true }); }, 60);
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    closePalette();
    refs.panel.hidden = true;
    refs.launcher.classList.remove("is-open");
    refs.launcher.setAttribute("aria-expanded", "false");
    document.body.classList.remove("pa-lock");
  }

  function togglePanel() {
    if (state.open) closePanel();
    else openPanel();
  }

  /** 有底部输入区（对话讲解）的页面，把启动器抬到输入区上方，避免遮住发送按钮 */
  function syncLauncherLift() {
    if (!refs.launcher) return;
    var lift = window.innerWidth <= 900 ? 16 : 24;
    var wrap = $(".composer-wrap");
    if (wrap) {
      var rect = wrap.getBoundingClientRect();
      var occupied = window.innerHeight - rect.top;
      if (occupied > 0 && occupied < window.innerHeight - 80) {
        lift = Math.max(lift, Math.round(occupied) + 14);
      }
    }
    refs.launcher.style.bottom = lift + "px";
  }

  /* ---------------------------- 指令面板 ---------------------------- */
  function renderPalette(filter) {
    var f = String(filter || "").toLowerCase();
    var items = COMMANDS.filter(function (c) {
      if (!f) return true;
      return (c.key + " " + c.label + " " + c.desc).toLowerCase().indexOf(f) > -1;
    });
    state.paletteItems = items;
    state.paletteIndex = 0;
    if (!items.length) {
      refs.palette.innerHTML = '<div class="pa-palette__empty">没有匹配的指令，试试 /help</div>';
      return;
    }
    refs.palette.innerHTML = items.map(function (c, i) {
      return '<button class="pa-palette__item' + (i === 0 ? " is-active" : "") + '" type="button" role="option" data-pa-cmd="' + c.key + '">' +
        icon(c.icon) +
        "<span><span>" + esc(c.label) + "</span><small>" + esc(c.desc) + "</small></span>" +
        "<code>/" + c.key + "</code>" +
      "</button>";
    }).join("");
    if (window.renderIcons) window.renderIcons(refs.palette);
  }

  function openPalette(filter) {
    state.paletteOpen = true;
    refs.palette.hidden = false;
    renderPalette(filter);
  }

  function closePalette() {
    state.paletteOpen = false;
    if (refs.palette) refs.palette.hidden = true;
  }

  function executeActiveCommand() {
    var cmd = state.paletteItems[state.paletteIndex];
    if (cmd) executeCommand(cmd);
    else closePalette();
  }

  function executeCommand(cmd) {
    refs.input.value = "";
    autoGrow();
    closePalette();
    syncSend();
    send(cmd.prompt);
  }

  function renderQuick() {
    refs.quick.innerHTML = COMMANDS.slice(0, 6).map(function (c) {
      return '<button class="pa-qchip" type="button" data-pa-quick="' + c.key + '">' + icon(c.icon) + esc(c.label) + "</button>";
    }).join("");
    if (window.renderIcons) window.renderIcons(refs.quick);
  }

  /* ---------------------------- 初始化 ---------------------------- */
  function restore() {
    var storedMsg = safeParse(STORE_MSG, []);
    state.messages = (Array.isArray(storedMsg) ? storedMsg : []).filter(function (m) {
      return m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.text === "string";
    });

    var storedCtx = safeParse(STORE_CTX, []);
    state.context = (Array.isArray(storedCtx) ? storedCtx : []).filter(function (c) {
      return c && typeof c === "object" && c.kind !== "page" && (c.kind === "concept" || c.kind === "topic") && typeof c.label === "string";
    });

    var key = currentPageKey();
    var meta = metaFor(key);
    var lastPage = safeParse(STORE_PAGE, null);

    if (!state.messages.length) {
      state.messages.push(welcomeMessage(meta));
    } else if (lastPage && lastPage !== key) {
      var count = state.messages.filter(function (m) { return m.role !== "system"; }).length;
      state.messages.push({
        id: uid("sys"),
        role: "system",
        text: "已切换到「" + meta.label + "」，保留 " + count + " 条上下文记忆",
        time: nowTime()
      });
    }

    ensurePageChip(meta);
    persistContext();
    persistMessages();
    safeSet(STORE_PAGE, key);
  }

  function bind() {
    refs.launcher.addEventListener("click", togglePanel);
    $("[data-pa-close]", refs.panel).addEventListener("click", closePanel);
    $("[data-pa-new]", refs.panel).addEventListener("click", newChat);

    refs.quick.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-pa-quick]");
      if (!chip) return;
      var cmd = findCommand(chip.getAttribute("data-pa-quick"));
      if (cmd) executeCommand(cmd);
    });

    $("[data-pa-palette]", refs.panel).addEventListener("click", function () {
      if (state.paletteOpen) closePalette();
      else openPalette("");
    });

    refs.palette.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pa-cmd]");
      if (!btn) return;
      var cmd = findCommand(btn.getAttribute("data-pa-cmd"));
      if (cmd) executeCommand(cmd);
    });

    refs.contextChips.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pa-unset]");
      if (!btn) return;
      var id = btn.getAttribute("data-pa-unset");
      state.context = state.context.filter(function (c) { return c.id !== id; });
      renderContext();
      persistContext();
      if (window.ui) window.ui.toast("已从上下文移除");
    });

    refs.stream.addEventListener("click", function (e) {
      var msgEl = e.target.closest(".pa-msg--assistant");
      if (!msgEl) return;
      var m = null;
      var id = msgEl.getAttribute("data-id");
      state.messages.forEach(function (item) { if (item.id === id) m = item; });
      if (e.target.closest("[data-pa-copy]")) { if (m) copyText(m.text); return; }
      if (e.target.closest("[data-pa-retry]")) retryMessage(msgEl);
    });

    refs.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.busy) { stopAll(); if (window.ui) window.ui.toast("已停止生成"); return; }
      send(refs.input.value);
    });

    refs.input.addEventListener("input", function () {
      autoGrow();
      syncSend();
      var value = refs.input.value;
      if (value.charAt(0) === "/" && value.indexOf(" ") === -1) openPalette(value.slice(1));
      else closePalette();
    });

    refs.input.addEventListener("keydown", function (e) {
      if (state.paletteOpen) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!state.paletteItems.length) return;
          state.paletteIndex += e.key === "ArrowDown" ? 1 : -1;
          if (state.paletteIndex < 0) state.paletteIndex = state.paletteItems.length - 1;
          if (state.paletteIndex >= state.paletteItems.length) state.paletteIndex = 0;
          $$(".pa-palette__item", refs.palette).forEach(function (item, i) {
            item.classList.toggle("is-active", i === state.paletteIndex);
          });
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); executeActiveCommand(); return; }
        if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!state.busy) send(refs.input.value);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (state.paletteOpen) { closePalette(); return; }
        var modalOpen = $$(".modal-backdrop").some(function (m) { return !m.hidden; });
        if (state.open && !modalOpen) closePanel();
        return;
      }
      if (e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        togglePanel();
      }
    });

    window.addEventListener("resize", function () {
      if (!state.open) document.body.classList.remove("pa-lock");
      else if (window.innerWidth <= 560) document.body.classList.add("pa-lock");
      else document.body.classList.remove("pa-lock");
      syncLauncherLift();
    });

    window.addEventListener("scroll", syncLauncherLift, { passive: true });

    var composerWrap = $(".composer-wrap");
    if (composerWrap) {
      if (window.ResizeObserver) new ResizeObserver(syncLauncherLift).observe(composerWrap);
      window.addEventListener("load", syncLauncherLift);
      [150, 500, 1200].forEach(function (ms) { setTimeout(syncLauncherLift, ms); });
    }

    window.addEventListener("pagehide", persistMessages);
  }

  function boot() {
    inject();
    bind();
    restore();
    renderStream();
    renderContext();
    renderQuick();
    syncSend();
    autoGrow();
    syncLauncherLift();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
