/* index.js: the live counts on the home page's Study tile, from the same
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
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
}(window, document));
