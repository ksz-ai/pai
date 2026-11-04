/* ============================================================
   app.js — 共享外壳逻辑（导航激活 / 图标 / toast / 弹窗）
   所有页面共用；页面只需填充 main 内容槽
   ============================================================ */
(function () {
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* 1. 导航激活：唯一机制 —— body[data-page] ↔ [data-nav] */
  function markNav() {
    var page = document.body.getAttribute("data-page");
    $$("[data-nav]").forEach(function (link) {
      var isActive = link.getAttribute("data-nav") === page;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  /* 2. Toast */
  function toast(message, kind) {
    var host = $(".toast-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    var el = document.createElement("div");
    el.className = "toast" + (kind === "warn" ? " toast--warn" : "");
    el.innerHTML = '<span data-icon="' + (kind === "warn" ? "alert-triangle" : "check-circle") + '"></span><span>' + message + "</span>";
    host.appendChild(el);
    if (window.renderIcons) window.renderIcons(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(function () { el.remove(); }, 320);
    }, 2600);
  }

  /* 3. 弹窗：data-modal-open="id" / data-modal-close */
  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    var focusable = modal.querySelector("input, textarea, select, button");
    if (focusable) focusable.focus();
  }
  function closeModal(target) {
    if (target && target.classList.contains("modal-backdrop")) target.hidden = true;
    else $$(".modal-backdrop").forEach(function (m) { if (m.hidden === false) m.hidden = true; });
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-modal-open]");
    if (opener) {
      e.preventDefault();
      openModal(opener.getAttribute("data-modal-open"));
    }
    var closer = e.target.closest("[data-modal-close]");
    if (closer) {
      e.preventDefault();
      closeModal(closer.closest(".modal-backdrop"));
    }
    if (e.target.classList && e.target.classList.contains("modal-backdrop")) closeModal(e.target);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  /* 4. 下载纯文本（导出 Markdown） */
  function download(filename, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 600);
  }

  /* 5. 分段控件通用切换（.segmented button） */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".segmented button");
    if (!btn) return;
    $$(".segmented button", btn.parentElement).forEach(function (b) { b.classList.remove("is-active"); });
    btn.classList.add("is-active");
  });

  /* 6. 主色进度条语义色 */
  function paintBars(root) {
    $$(".bar", root).forEach(function (bar) {
      var fill = bar.querySelector("i");
      if (!fill) return;
      var pct = parseFloat(fill.style.getPropertyValue("--pct") || fill.style.width) || 0;
      if (pct < 30) bar.classList.add("bar--low");
      else if (pct < 70) bar.classList.add("bar--mid");
    });
  }

  function init() {
    markNav();
    if (window.renderIcons) window.renderIcons(document);
    paintBars(document);
  }

  window.ui = {
    $: $,
    $$: $$,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    download: download,
    paintBars: paintBars
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
