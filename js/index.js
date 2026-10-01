/* index.js: the live counts on the home page's tiles. Study: from the same
 * data file the study page reads, and this browser's own progress for how much
 * of it has been answered. Progress is read here, never written. A failure
 * leaves the stat line as a dash, never a broken page.
 */
(function (window, document) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  function stat(n, label) { return '<div class="stat"><b>' + n + "</b><span>" + label + "</span></div>"; }

  function start() {
    fetch("/data/ham-study.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      return r.json();
    }).then(function (data) {
      if (!data.questions) { throw new Error("no questions"); }
      var progress = {};
      try { progress = JSON.parse(window.localStorage.getItem("ham-study-progress-v1") || "{}") || {}; }
      catch (e) { progress = {}; }
      var answered = data.questions.filter(function (q) { return progress[q.id]; }).length;
      $("hi-study-stats").innerHTML = stat(data.questions.length, "questions, " + data.pools.length + " pools") +
        stat(answered, "answered in this browser");
    }).catch(function () { $("hi-study-stats").innerHTML = stat("&ndash;", "unavailable"); });
  }
  // Call signs: the index's own meta from the search the call sign page uses.
  var CALLSIGN_META = "https://man.tcos.us/cgi-bin/callsign.cgi?meta=1";
  function callsigns() {
    fetch(CALLSIGN_META, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      return r.json();
    }).then(function (m) {
      if (!m.rows) { throw new Error("no rows"); }
      $("hi-callsign-stats").innerHTML = stat(Number(m.rows).toLocaleString("en-US"), "call signs on file") +
        stat(String(m.built_at || "").slice(0, 10) || "&ndash;", "index built");
    }).catch(function () { $("hi-callsign-stats").innerHTML = stat("&ndash;", "unavailable"); });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", callsigns); } else { callsigns(); }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
}(window, document));
