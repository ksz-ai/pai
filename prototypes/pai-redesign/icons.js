/* ============================================================
   icons.js — Lucide 图标（内联 SVG，零外部依赖，可离线）
   用法：<span data-icon="search"></span> 或 data-icon + class
   动态插入内容后调用 window.renderIcons(container)
   ============================================================ */
(function () {
  var P = {
    home: '<path d="m3 10.5 9-7.5 9 7.5"/><path d="M5 10v10.5h14V10"/>',
    "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "book-open": '<path d="M2 4.5h6a4 4 0 0 1 4 4V21a3.5 3.5 0 0 0-3.5-3.5H2z"/><path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3.5 3.5 0 0 1 3.5-3.5H22z"/>',
    fingerprint: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 0-9 9v2.5"/><path d="M22 14.5V12a9 9 0 0 0-9-9"/><path d="M6 12a6 6 0 0 1 12 0v2.5"/><path d="M9 12a3 3 0 0 1 6 0v4"/>',
    "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3.2-6.9"/><path d="M3 4.5V10h5.5"/>',
    sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
    flame: '<path d="M12 3c2.4 2.9 4.6 5.3 4.6 8.6a4.6 4.6 0 0 1-9.2 0c0-1.5.6-2.8 1.5-4"/><path d="M12 21a3 3 0 0 0 3-3c0-1.8-1.6-3-3-4.5-1.4 1.5-3 2.7-3 4.5a3 3 0 0 0 3 3z"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.4-4.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    sparkles: '<path d="M12 3.5 13.7 8 18 9.7 13.7 11.4 12 16 10.3 11.4 6 9.7 10.3 8z"/><path d="M5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
    "chevron-left": '<path d="m15 6-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 1.9"/>',
    check: '<path d="m5 12.5 4.8 4.8L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    "alert-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.5" r=".9" fill="currentColor"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    merge: '<circle cx="7" cy="5" r="2.5"/><circle cx="7" cy="19" r="2.5"/><circle cx="17" cy="12" r="2.5"/><path d="M7 7.5v9"/><path d="M9 5.8c4.3 0 5.8 2.4 5.8 4.2"/><path d="M9 18.2c4.3 0 5.8-2.4 5.8-4.2"/>',
    filter: '<path d="M4 5h16l-6.2 7.2V19l-3.6 2v-8.8z"/>',
    "arrow-up-right": '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    "arrow-right": '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
    "arrow-left": '<path d="M20 12H4"/><path d="m10 6-6 6 6 6"/>',
    lightbulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.4 10.9c.5.4.9 1 .9 1.6h5c0-.6.4-1.2.9-1.6A6 6 0 0 0 12 3z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4z"/>',
    "refresh-cw": '<path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M21 4.5v5h-5"/><path d="M3 19.5v-5h5"/>',
    "trash-2": '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 10v6M14 10v6"/>',
    "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-1"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
    "more-horizontal": '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    "link-2": '<path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    "bar-chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 8-8"/><path d="m16 4 4 4"/><path d="m14 6 3 3"/>',
    "file-text": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    "external-link": '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V8.5A1.5 1.5 0 0 1 5.5 7H11"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
    bookmark: '<path d="M6 4h12v17l-6-4.5-6 4.5z"/>',
    "circle-help": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
    "git-branch": '<circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="6" cy="19" r="2.5"/><path d="M6 7.5V16"/><path d="M18 9.5c0 4-4 4.5-9 5"/>',
    brain: '<path d="M9.5 4.5A3 3 0 0 0 6.5 7c-1.7 0-3 1.4-3 3.2 0 1 .4 1.8 1.2 2.5-.4.6-.7 1.3-.7 2.1A3.2 3.2 0 0 0 7.2 18c.3 1.5 1.6 2.5 3.3 2.5 1.2 0 2.2-.6 2.9-1.5"/><path d="M14.5 4.5A3 3 0 0 1 17.5 7c1.7 0 3 1.4 3 3.2 0 1-.4 1.8-1.2 2.5.4.6.7 1.3.7 2.1A3.2 3.2 0 0 1 16.8 18c-.3 1.5-1.6 2.5-3.3 2.5-1.2 0-2.2-.6-2.9-1.5"/><path d="M12 4v16"/>',
    zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    loader: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><path d="m8.4 15.6-2.8 2.8"/>',
    quote: '<path d="M9 10H4.5v6h5v-4"/><path d="M20 10h-4.5v6h5v-4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    "share-2": '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.7 7.4-4.2"/><path d="m8.3 13.3 7.4 4.2"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="2.8"/><path d="M4 6v6c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8V6"/><path d="M4 12v6c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8v-6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    "graduation-cap": '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V17c0 1.6 2.7 3 6 3s6-1.4 6-3v-5.5"/><path d="M22 9v6"/>',
    "panel-right": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    "pen-line": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4z"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    tag: '<path d="M20.5 12.5 12 21 3 12V3h9l8.5 8.5a1.4 1.4 0 0 1 0 1z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    "trending-up": '<path d="M3 17 9 11l4 4 8-9"/><path d="M16 6h5v5"/>',
    "alert-triangle": '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r=".9" fill="currentColor"/>',
    "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    "mouse-pointer": '<path d="m3 3 7.5 18 2.5-7.5L20.5 11z"/>'
  };

  function classOf(el) {
    var c = el.getAttribute("data-icon-class");
    if (c) return c;
    return el.className && el.className.indexOf("icon") > -1 ? el.className : "icon";
  }

  function render(el) {
    var name = el.getAttribute("data-icon");
    var body = P[name] || P["circle-help"];
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", classOf(el));
    svg.innerHTML = body;
    el.replaceWith(svg);
  }

  function renderIcons(root) {
    var scope = root || document;
    var list = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < list.length; i++) render(list[i]);
  }

  window.renderIcons = renderIcons;
  window.ICON_PATHS = P;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { renderIcons(document); });
  } else {
    renderIcons(document);
  }
})();
