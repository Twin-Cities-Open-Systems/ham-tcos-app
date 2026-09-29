/* shell.js: the text-size buttons and the theme dropdown, on every page. OWNED by tcos-app;
 * children copy it, never edit the copy (tcos-app CLAUDE.md, "How a child app inherits").
 *
 * Choices persist in localStorage and are applied before paint by the inline
 * bootstrap in each page's <head>; this file only wires the controls. A
 * browser that blocks storage still works, it just forgets.
 */
(function () {
  "use strict";

  function get(key, fallback) {
    try { return window.localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* forgets */ }
  }
  function press(group, val, attr) {
    document.querySelectorAll(group).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset[attr] === val));
    });
  }

  var fs = get("tc-fs", "m");
  document.documentElement.setAttribute("data-fs", fs);
  press(".fontsize-btn", fs, "size");
  document.querySelectorAll(".fontsize-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.dataset.size;
      document.documentElement.setAttribute("data-fs", v);
      set("tc-fs", v);
      press(".fontsize-btn", v, "size");
    });
  });

  /* Small screens: fold nav, text size and theme behind one menu button. The button is made
     here, not in each page, so a page needs no markup change and no script leaves it all visible. */
  var top = document.querySelector("header.top");
  if (top && !top.querySelector(".menu-btn")) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-btn";
    btn.setAttribute("aria-label", "Menu");
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "\u2630";
    var brand = top.querySelector(".brand");
    top.insertBefore(btn, brand ? brand.nextSibling : top.firstChild);
    top.classList.add("tc-menu");
    var shut = function () {
      top.removeAttribute("data-open");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "\u2630";
    };
    btn.addEventListener("click", function () {
      var open = !top.hasAttribute("data-open");
      if (!open) { shut(); return; }
      top.setAttribute("data-open", "");
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "\u2715";
    });
    top.querySelectorAll("nav a").forEach(function (a) { a.addEventListener("click", shut); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && top.hasAttribute("data-open")) { shut(); btn.focus(); }
    });
  }

  /* "auto" removes the stamps entirely, so the page falls back to
     prefers-color-scheme, the unstamped state the CSS is built for. A named
     theme is a light or dark base plus a skin; keep KIND in step with the
     inline bootstrap in each page's <head>. */
  var KIND = { paper: "light", contrast: "light", midnight: "dark", graphite: "dark" };
  function applyTheme(v) {
    var root = document.documentElement;
    if (v === "auto") { root.removeAttribute("data-theme"); root.removeAttribute("data-skin"); return; }
    root.setAttribute("data-theme", KIND[v] || v);
    root.setAttribute("data-skin", v);
  }
  var th = get("tc-theme", "auto");
  var pick = document.querySelector(".theme-select");
  applyTheme(th);
  if (pick) {
    pick.value = th;
    pick.addEventListener("change", function () {
      applyTheme(pick.value);
      set("tc-theme", pick.value);
    });
  }
})();
