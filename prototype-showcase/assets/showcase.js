/* prototype-showcase · 预览缩放、流程图渲染与目录高亮 */
(function () {
  "use strict";

  var DESIGN_WIDTH = 1440;
  var DESIGN_HEIGHT = 900;

  /* ---------- 1. 内嵌页面按容器宽度等比缩放 ---------- */
  function fitPreview(box) {
    var viewport = box.querySelector(".browser__viewport");
    if (!viewport) return;
    var iframe = viewport.querySelector("iframe");
    if (!iframe) return;

    var width = viewport.clientWidth;
    if (!width) return;

    var scale = width / DESIGN_WIDTH;
    iframe.style.transform = "scale(" + scale + ")";
    viewport.style.height = Math.round(DESIGN_HEIGHT * scale) + "px";
  }

  function fitAll() {
    var boxes = document.querySelectorAll("[data-preview]");
    for (var i = 0; i < boxes.length; i++) fitPreview(boxes[i]);
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(fitAll, 120);
  });

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var target = entries[i].target;
        var box = target.closest("[data-preview]");
        if (box) fitPreview(box);
      }
    });
    var boxes = document.querySelectorAll("[data-preview] .browser__viewport");
    for (var j = 0; j < boxes.length; j++) observer.observe(boxes[j]);
  }

  fitAll();
  window.addEventListener("load", fitAll);

  /* ---------- 2. Mermaid 闭环图 ---------- */
  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      fontFamily: "WorkSans, PingFang SC, Microsoft YaHei, sans-serif",
      themeVariables: {
        fontSize: "14px",
        primaryColor: "#e6f1ec",
        primaryBorderColor: "#1d6f5f",
        primaryTextColor: "#1f2320",
        lineColor: "#c9c2b1",
        tertiaryColor: "#f6ebdc",
        tertiaryBorderColor: "#b4762e",
        tertiaryTextColor: "#1f2320",
        edgeLabelBackground: "#ffffff"
      },
      flowchart: { curve: "basis", padding: 18, nodeSpacing: 34, rankSpacing: 54 }
    });
    window.mermaid.run({ nodes: document.querySelectorAll(".mermaid") });
  }

  /* ---------- 3. 顶部目录高亮 ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll(".topnav a"));
  var sections = links
    .map(function (link) {
      var id = link.getAttribute("href").slice(1);
      return { link: link, section: document.getElementById(id) };
    })
    .filter(function (item) { return item.section; });

  if (sections.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (l) { l.classList.remove("is-active"); });
          var match = sections.filter(function (item) { return item.section === entry.target; })[0];
          if (match) match.link.classList.add("is-active");
        });
      },
      { rootMargin: "-84px 0px -70% 0px", threshold: 0 }
    );
    sections.forEach(function (item) { spy.observe(item.section); });
  }
})();
