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
