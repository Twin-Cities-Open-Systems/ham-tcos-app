/* callsign.js -- ham.tcos.app/callsign: call sign search. Ported from fleet-ops
 * view/assets/callsign.js (ham.lab), which speaks the same protocol to the same CGI. */
/* callsign.js -- /callsign.html: regex search over the full FCC amateur call
 * sign database, and a lookup by holder name/city/state.
 *
 * section: 3
 *
 * Operator, 2026-09-17: "should be able to search for any regex against all
 * call signs, not just the [branded] hee an[d] yaw [terms]", and "put the
 * full info. do not hold anything public back." view/cgi-bin/callsign.cgi
 * answers both modes from ham/callsign/index.py's weekly output; this file
 * only renders what it returns. No client-side cache of the whole database:
 * a lab tool searches a live endpoint, the same reason view/README.md gives
 * for every other search box here.
 */
(function (window, document) {
  "use strict";

  // The search runs on man.tcos.us: the same CGI as the lab's, over the index CI
// rebuilds weekly from the FCC's files. Its CORS answers this origin and the lab mirror.
var CGI = "https://man.tcos.us/cgi-bin/callsign.cgi";
  var COLUMNS = ["call", "status", "class", "group", "format", "grant", "expires",
                 "cancelled", "system_id", "name", "city", "state"];
  var STATUS_CHIP = {
    A: ["good", "ACTIVE"], C: ["neutral", "CANCELLED"], E: ["warning", "EXPIRED"], T: ["critical", "TERMINATED"]
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = { mode: "call", q: "", status: "", cls: "", name: "", cols: {}, rows: [], byCall: {} };
  // By holder: one filter per Results column, sent to the CGI as f_<column> and
  // applied over the whole index before its 200-row cap (operator, 2026-10-01:
  // "each column should be a filter as well as the sort").
  function colQuery() {
    return Object.keys(state.cols).filter(function (k) { return state.cols[k]; }).map(function (k) {
      return "f_" + k + "=" + encodeURIComponent(state.cols[k]);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function chip(status) {
    var c = STATUS_CHIP[status] || ["neutral", status || "UNKNOWN"];
    var icon = { good: "✔", neutral: "○", warning: "▲", critical: "✖" }[c[0]] || "?";
    return '<span class="chip ' + c[0] + '">' + icon + " " + esc(c[1]) + "</span>";
  }

  /* --- fetch and parse the CGI's TSV ---------------------------------------- */
  function parseTsv(text) {
    var lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
    if (!lines.length || !lines[0]) { return []; }
    return lines.slice(1).filter(function (l) { return l.length; }).map(function (line) {
      var parts = line.split("\t"), row = {};
      COLUMNS.forEach(function (k, i) { row[k] = parts[i] || ""; });
      return row;
    });
  }

  function buildQuery() {
    var p = [];
    if (state.mode === "call") {
      if (!state.q) { return null; }
      p.push("q=" + encodeURIComponent(state.q));
      if (state.status) { p.push("status=" + encodeURIComponent(state.status)); }
      if (state.cls) { p.push("class=" + encodeURIComponent(state.cls)); }
    } else {
      var cols = colQuery();
      if (!state.name && !cols.length) { return null; }
      if (state.name) { p.push("name=" + encodeURIComponent(state.name)); }
      p = p.concat(cols);
    }
    return p.join("&");
  }

  var fetchToken = 0;
  function search() {
    var qs = buildQuery();
    var errBox = $("cs-q-error");
    errBox.hidden = true; errBox.textContent = "";
    $("cs-q").removeAttribute("aria-invalid");
    if (qs === null) {
      state.rows = []; renderRows(); $("cs-count").textContent = "type a call regex, a holder, or a column filter to search"; return;
    }
    var token = ++fetchToken;
    $("cs-count").textContent = "searching…";
    fetch(CGI + "?" + qs, { cache: "no-store" }).then(function (r) {
      if (token !== fetchToken) { return null; }
      if (r.status === 503) { return r.json().then(function (d) { throw new Error(d.label || "the index is unavailable"); }); }
      if (r.status === 400) {
        return r.json().then(function (d) {
          if (state.mode === "call") {
            errBox.textContent = d.label || "not a valid pattern";
            errBox.hidden = false;
            $("cs-q").setAttribute("aria-invalid", "true");
          }
          throw new Error(d.label || "bad request");
        });
      }
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      var total = r.headers.get("X-Total");
      return r.text().then(function (text) { return { text: text, total: total }; });
    }).then(function (res) {
      if (!res || token !== fetchToken) { return; }
      state.rows = parseTsv(res.text);
      state.byCall = {};
      state.rows.forEach(function (row) { state.byCall[row.call] = row; });
      renderRows();
      $("cs-count").textContent = (res.total || state.rows.length) + " match" + (res.total === "1" ? "" : "es") +
        (Number(res.total) >= 200 ? " (capped at 200 -- narrow the search)" : "");
    }).catch(function (e) {
      if (token !== fetchToken) { return; }
      // An invalid pattern or a transient error keeps the last good result on
      // screen -- the same rule the study page's own search box follows.
      $("cs-count").textContent = String(e && e.message || e);
    });
  }

  function renderRows() {
    $("cs-rows").innerHTML = state.rows.map(function (r) {
      return "<tr><td>" + callButton(r.call) + "</td><td>" + chip(r.status) + "</td><td>" + esc(r.class) + "</td>" +
        "<td>" + esc(r.group) + "</td><td>" + esc(r.format) + "</td>" +
        '<td class="mono" data-tc-sort-value="' + esc(r.grant) + '">' + esc(r.grant) + "</td>" +
        '<td class="mono" data-tc-sort-value="' + esc(r.expires) + '">' + esc(r.expires) + "</td>" +
        "<td>" + esc(r.name) + "</td><td>" + esc(r.city) + "</td><td>" + esc(r.state) + "</td></tr>";
    }).join("");
    $("cs-rows-count").textContent = state.rows.length + " row" + (state.rows.length === 1 ? "" : "s") + " shown";
    if (window.TC && window.TC.table) { window.TC.table.init($("cs-table")); }
  }

  function callButton(call) {
    return '<button class="cs-call" type="button" data-call="' + esc(call) + '">' + esc(call) + "</button>";
  }

  /* --- detail panel --------------------------------------------------------- */
  function openDetail(call) {
    var r = state.byCall[call];
    var card = $("card-detail"), body = $("cs-detail-body");
    if (!r) { card.hidden = true; return; }
    var dl = [
      ["Status", chip(r.status)], ["Class", esc(r.class) || "–"],
      ["Group / format", esc(r.group || "–") + " / " + esc(r.format || "–")],
      ["Granted", esc(r.grant) || "–"], ["Expires", esc(r.expires) || "–"],
      ["Cancelled", esc(r.cancelled) || "–"],
      ["ULS system id", r.system_id ? '<span class="mono">' + esc(r.system_id) + "</span>" : "–"],
      ["Holder", esc(r.name) || "–"], ["City", esc(r.city) || "–"], ["State", esc(r.state) || "–"]
    ];
    var links = ['<a href="https://callook.info/' + encodeURIComponent(call) + '" rel="noopener">callook.info</a>'];
    if (r.system_id) {
      links.unshift('<a href="https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=' +
        encodeURIComponent(r.system_id) + '" rel="noopener">FCC ULS license</a>');
    }
    $("detail-h").textContent = call;
    body.innerHTML = "<dl>" + dl.map(function (p) { return "<dt>" + p[0] + "</dt><dd>" + p[1] + "</dd>"; }).join("") +
      '</dl><p class="cs-links">' + links.join("") + "</p>";
    card.hidden = false;
    card.scrollIntoView({ block: "nearest" });
    $("detail-h").focus({ preventScroll: true });
  }

  /* --- format check ---------------------------------------------------------- */
  function checkFormat() {
    var v = $("cs-check").value.trim().toUpperCase(), out = $("cs-check-result");
    if (!v) { out.innerHTML = ""; return; }
    var problem = window.TC && TC.callsign ? TC.callsign.formatProblem(v) : null;
    if (problem === null) {
      var inFile = state.byCall[v];
      out.innerHTML = '<span class="chip good">✔ A FORMAT THE FCC ASSIGNS</span>' +
        (inFile ? " -- and it is in the current search results below." : "");
    } else if (problem) {
      out.innerHTML = '<span class="chip critical">✖ NOT ASSIGNABLE</span> ' + esc(problem) + ".";
    } else {
      out.innerHTML = "";
    }
  }

  /* --- freshness -------------------------------------------------------------- */
  function loadMeta() {
    fetch(CGI + "?meta=1", { cache: "no-store" }).then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      return r.json();
    }).then(function (m) {
      $("cs-fresh").textContent = "Index built " + (m.built_at || "–") + " · " +
        (m.rows != null ? m.rows + " call signs on file" : "");
    }).catch(function () {
      $("cs-fresh").textContent = "";
    });
  }

  /* --- wiring ------------------------------------------------------------------ */
  function setMode(mode) {
    state.mode = mode;
    ["call", "holder"].forEach(function (m) {
      $("cs-panel-" + m).hidden = m !== mode;
      $("cs-filters").hidden = mode !== "holder";
      document.querySelector('.tab[data-mode="' + m + '"]').setAttribute("aria-selected", String(m === mode));
    });
    search();
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-mode]"), function (t) {
      t.addEventListener("click", function () { setMode(t.getAttribute("data-mode")); });
    });
    var qTimer = null;
    $("cs-q").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.q = v; search(); }, 200);
    });
    $("cs-q").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { this.value = ""; state.q = ""; search(); }
    });
    $("cs-status").addEventListener("change", function () { state.status = this.value; search(); });
    $("cs-class").addEventListener("change", function () { state.cls = this.value; search(); });
    var nameTimer = null;
    $("cs-name").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(nameTimer);
      nameTimer = setTimeout(function () { state.name = v; search(); }, 200);
    });
    var colTimer = null;
    Array.prototype.forEach.call(document.querySelectorAll("#cs-filters .cs-f"), function (f) {
      var col = f.getAttribute("data-col");
      // The value is recorded at once; only the search waits, so typing in two
      // filters quickly keeps both.
      var apply = function (wait) {
        state.cols[col] = f.value.trim();
        clearTimeout(colTimer);
        colTimer = setTimeout(search, wait);
      };
      f.addEventListener(f.tagName === "SELECT" ? "change" : "input", function () {
        apply(f.tagName === "SELECT" ? 0 : 250);
      });
      f.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && f.value) { f.value = ""; apply(0); }
      });
    });
    $("cs-rows").addEventListener("click", function (e) {
      var b = e.target.closest(".cs-call");
      if (b) { openDetail(b.getAttribute("data-call")); }
    });
    var checkTimer = null;
    $("cs-check").addEventListener("input", function () {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(checkFormat, 150);
    });
  }

  function start() {
    wire();
    if (window.TC && window.TC.wayback) { window.TC.wayback.init($("cs-jump"), { heading: "h1" }); }
    loadMeta();
    $("cs-count").textContent = "type a call regex or a holder to search";
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
}(window, document));
