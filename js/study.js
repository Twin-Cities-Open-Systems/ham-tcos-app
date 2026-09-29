/* study.js -- the study page: the amateur radio license exams, from the
 * official NCVEC question pools.
 *
 * The questions come from /data/ham-study.json, which build.py writes from
 * ham/pools and which is committed. Nothing here is typed by hand.
 *
 * Modes over one pool:
 *   guide       the answer to every question, colored by topic family
 *   browse      every group as a card of question pills; a pill opens to its
 *               choices with the answer marked
 *   flashcards  one question at a time from the current filter; keys 1-4
 *               answer, arrow keys move
 *   exam        the pool's own draw, scored against its passing score
 *   mastery     one square per question, filled by times answered right
 *
 * Progress -- seen, right and missed per question -- stays in this browser's
 * localStorage. Every read and write is wrapped: a browser that blocks storage
 * still gets the whole page, it just forgets. Nothing is sent anywhere.
 *
 * Every right/wrong mark is an icon AND a word, never color alone.
 */
(function (window, document) {
  "use strict";

  var DATA_URL = "/data/ham-study.json";
  var STORE = "ham-study-progress-v1";
  var SHOW_KEY = "ham-study-show-answer-v1";
  var ICON = { good: "✔", critical: "✖", neutral: "○", warning: "▲" };

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    data: null, byId: {}, pool: "", mode: "guide", sub: "", group: "", q: "", missedOnly: false,
    deck: [], card: 0, shuffled: false, answered: null, exam: null, showAnswer: true
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function chip(kind, icon, label) { return '<span class="chip ' + kind + '">' + icon + " " + esc(label) + "</span>"; }

  /* --- progress ----------------------------------------------------------- */
  var storageOk = (function () {
    try { window.localStorage.setItem(STORE + ".probe", "1"); window.localStorage.removeItem(STORE + ".probe"); return true; }
    catch (e) { return false; }
  }());
  function loadProgress() {
    try { var v = JSON.parse(window.localStorage.getItem(STORE) || "{}"); return v && typeof v === "object" ? v : {}; }
    catch (e) { return {}; }
  }
  function saveProgress() { try { window.localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* forgets */ } }
  var progress = loadProgress();
  /* Memorize mode: show the correct answer on every flashcard without
     asking first. On unless the reader turned it off ("0"). */
  function loadShowAnswer() {
    try { return window.localStorage.getItem(SHOW_KEY) !== "0"; } catch (e) { return true; }
  }
  function saveShowAnswer(on) { try { window.localStorage.setItem(SHOW_KEY, on ? "1" : "0"); } catch (e) { /* forgets */ } }
  state.showAnswer = loadShowAnswer();
  /* "Missed" means the LAST answer was wrong: a question answered right since
     is no longer in the missed-only deck, which is the point of drilling it. */
  function record(id, ok) {
    var r = progress[id] || { seen: 0, correct: 0, missed: 0 };
    r.seen += 1;
    if (ok) { r.correct += 1; } else { r.missed += 1; }
    r.last = ok ? "correct" : "missed";
    progress[id] = r;
    saveProgress();
  }

  /* --- the pool and the filter -------------------------------------------- */
  function poolObj() {
    var ps = state.data.pools;
    for (var i = 0; i < ps.length; i++) { if (ps[i].pool === state.pool) { return ps[i]; } }
    return ps[0];
  }
  function poolQuestions() {
    return state.data.questions.filter(function (q) { return q.pool === state.pool; });
  }
  function matcher() {
    var t = state.q.trim();
    if (!t) { $("hs-status").textContent = ""; return null; }
    try {
      var re = new RegExp(t, "i");
      $("hs-status").textContent = "";
      return function (s) { return re.test(s); };
    } catch (e) {
      $("hs-status").innerHTML = chip("warning", ICON.warning, "not a valid regular expression") + " matching it as plain text";
      var lt = t.toLowerCase();
      return function (s) { return s.toLowerCase().indexOf(lt) >= 0; };
    }
  }
  function filtered() {
    var m = matcher();
    return poolQuestions().filter(function (q) {
      if (state.sub && q.subelement !== state.sub) { return false; }
      if (state.group && q.group !== state.group) { return false; }
      if (state.missedOnly) { var r = progress[q.id]; if (!r || r.last !== "missed") { return false; } }
      if (m) {
        var hay = [q.id, q.question, q.choices.A, q.choices.B, q.choices.C, q.choices.D].join("\n");
        if (!m(hay)) { return false; }
      }
      return true;
    });
  }

  /* --- shared pieces ------------------------------------------------------ */
  function choicesHtml(q, picked) {
    return '<ul class="ham-choices">' + ["A", "B", "C", "D"].map(function (k) {
      var cls = "", tag = "";
      if (k === q.correct) { cls = " is-correct"; tag = " " + chip("good", ICON.good, "correct"); }
      else if (picked === k) { cls = " is-wrong"; tag = " " + chip("critical", ICON.critical, "your answer"); }
      else { cls = " is-other"; }
      return '<li class="ham-choice' + cls + '"><span class="mono">' + k + ".</span> " + esc(q.choices[k]) + tag + "</li>";
    }).join("") + "</ul>";
  }
  function figureHtml(q) {
    if (!q.figure) { return ""; }
    return '<figure class="ham-fig"><img src="' + esc(q.figure) + '" alt="Figure ' + esc(q.figure_id) +
      ' for question ' + esc(q.id) + '"><figcaption class="hint">Figure ' + esc(q.figure_id) + ", NCVEC</figcaption></figure>";
  }
  function lastMark(id) {
    var r = progress[id];
    if (!r) { return ""; }
    return r.last === "missed" ? " " + chip("critical", ICON.critical, "missed last time") : " " + chip("good", ICON.good, "right last time");
  }

  /* --- families: identity color, never alone --------------------------------
   * ham/families.yaml carries {light, dark} per family; the page turns that
   * into one --fam-<id> custom property per family, following css/site.css's own
   * theming pattern (a media query for the OS setting, a [data-theme] scope
   * for the toggle, the toggle winning both ways) so the light/dark swap
   * lives in one place, and every use below references the role, not a hex. */
  function familyMap() {
    var m = {};
    (state.data.families || []).forEach(function (f) { m[f.id] = f; });
    return m;
  }
  function injectFamilyColors(families) {
    if (!families || !families.length) { return; }
    var light = families.map(function (f) { return "--fam-" + f.id + ":" + f.color.light; }).join(";");
    var dark = families.map(function (f) { return "--fam-" + f.id + ":" + f.color.dark; }).join(";");
    var css = ":root{" + light + "}\n" +
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){' + dark + "}}\n" +
      ':root[data-theme="dark"]{' + dark + "}\n";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  function famDot(famId) {
    return '<span class="ham-fam-dot" aria-hidden="true" style="--fam:var(--fam-' + esc(famId) + ')"></span>';
  }
  /* Mastery map fill: the dataviz skill's single sequential blue ramp, steps
   * 100..700 (one hue, light -> dark). It is one ramp reused by both themes,
   * not a separate light/dark pair: on a light surface the near-zero end must
   * be no lighter than step 250 to clear 2:1, so magnitude runs light -> dark
   * (250, 350, 450, 550, 650); on a dark surface the near-zero end must be no
   * darker than step 600, so the same five steps run the other way (600, 500,
   * 400, 300, 200) -- magnitude always moves away from the surface, toward
   * more contrast, in both themes. */
  function injectMasteryColors() {
    var light = ["--m1:#86b6ef", "--m2:#5598e7", "--m3:#2a78d6", "--m4:#1c5cab", "--m5:#104281"].join(";");
    var dark = ["--m1:#184f95", "--m2:#256abf", "--m3:#3987e5", "--m4:#6da7ec", "--m5:#9ec5f4"].join(";");
    var css = ":root{" + light + "}\n" +
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){' + dark + "}}\n" +
      ':root[data-theme="dark"]{' + dark + "}\n";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  /* --- jumping between panels ------------------------------------------------
   * A cell in the Mastery map opens the question it names: switch panel, clear whatever filter would hide it,
   * render, then scroll the target into view and flash it once. */
  function jumpTo(mode, elId, focus) {
    state.mode = mode;
    if (mode === "guide" && focus) {
      var q = state.byId[focus];
      if (q) { state.sub = q.subelement; state.group = ""; state.q = ""; state.missedOnly = false; $("hs-search").value = ""; $("hs-missed").checked = false; fillFilters(); }
    }
    render();
    requestAnimationFrame(function () {
      var el = $(elId);
      if (!el) { return; }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("is-jumped");
      setTimeout(function () { el.classList.remove("is-jumped"); }, 1600);
    });
  }

  /* --- guide: the answer first, colored by topic family --------------------
   * Default mode. Every question already carries its family and computed
   * answer(s) from build.py (families.yaml + the "all of the above"
   * rule); this only lays them out, family by family in
   * the fixed slot order, subelement by subelement, group by group. */
  function renderGuide() {
    var box = $("hs-guide");
    var qs = filtered();
    var p = poolObj();
    var byGroup = {};
    qs.forEach(function (q) { (byGroup[q.group] = byGroup[q.group] || []).push(q); });
    var byFamily = {};
    p.subelements.forEach(function (s) { (byFamily[s.family] = byFamily[s.family] || []).push(s); });
    var out = [];
    (state.data.families || []).forEach(function (fam) {
      var subs = (byFamily[fam.id] || []).filter(function (s) { return !state.sub || s.id === state.sub; });
      var famQs = 0, subsHtml = [];
      subs.forEach(function (s) {
        var groupsHtml = [];
        s.groups.forEach(function (g) {
          var list = byGroup[g.id];
          if (!list || !list.length) { return; }
          famQs += list.length;
          groupsHtml.push('<div class="ham-ggroup"><h5><span class="mono">' + esc(g.id) + "</span> " + esc(g.title) + "</h5>" +
            '<ul class="ham-gcards">' + list.map(guideCardHtml).join("") + "</ul></div>");
        });
        if (groupsHtml.length) {
          subsHtml.push('<div class="ham-gsub"><h4><span class="mono">' + esc(s.id) + "</span> " + esc(s.title) + "</h4>" +
            groupsHtml.join("") + "</div>");
        }
      });
      if (!subsHtml.length) { return; }
      out.push('<section class="ham-fam" style="--fam:var(--fam-' + esc(fam.id) + ')">' +
        '<div class="ham-fam-head">' + famDot(fam.id) + "<h3>" + esc(fam.title) + "</h3>" +
        '<span class="count">' + famQs + " question" + (famQs === 1 ? "" : "s") + "</span></div>" +
        '<div class="ham-fam-body">' + subsHtml.join("") + "</div></section>");
    });
    box.innerHTML = out.length ? out.join("") : "<p>" + chip("neutral", ICON.neutral, "no questions match") + "</p>";
    $("hs-count").textContent = qs.length + " of " + poolQuestions().length + " questions";
  }
  function guideCardHtml(q) {
    var ansHtml = q.answers
      ? '<p class="ham-gans"><span class="mono">' + esc(q.id) + "</span> All of these are correct:</p>" +
        '<ul class="ham-gall">' + q.answers.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>"
      : '<p class="ham-gans"><span class="mono">' + esc(q.id) + "</span> " + esc(q.answer) + "</p>";
    return '<li class="ham-gcard" id="hs-guide-' + esc(q.id) + '">' + ansHtml + '<p class="ham-gq">' + esc(q.question) + "</p>" +
      figureHtml(q) +
      (q.rule_ref ? '<p class="hint">FCC rule ' + esc(q.rule_ref) + "</p>" : "") + "</li>";
  }

  /* --- mastery map -------------------------------------------------------------
   * One square per question, grouped by family. Fill is a sequential blue ramp
   * by times answered right -- the same ramp both themes draw from, its usable
   * span reversed per theme so magnitude always moves away from the surface
   * (dataviz's ordinal-ramp floor: on light nothing lighter than step 250, on
   * dark nothing darker than step 600, both >= 2:1). A missed-last-time icon
   * overlays the fill so status is never color alone, and the exact numbers
   * are the Progress card's table below -- the fill's relief channel. */
  function masteryBucket(id) {
    var r = progress[id];
    return r && r.correct ? Math.min(r.correct, 5) : 0;
  }
  function masteryCellHtml(q) {
    var n = masteryBucket(q.id);
    var style = n ? ' style="background:var(--m' + n + ');border-color:var(--m' + n + ')"' : "";
    var r = progress[q.id];
    var miss = r && r.last === "missed" ? '<span class="ham-mmiss" aria-hidden="true">' + ICON.critical + "</span>" : "";
    var ans = q.answers ? "all of the above" : q.answer;
    var title = q.id + " -- " + ans + (r ? " (" + r.correct + "/" + r.seen + " right)" : " (not yet seen)");
    return '<button type="button" class="ham-mcell" data-jump="question" data-key="' + esc(q.id) + '"' + style +
      ' title="' + esc(title) + '" aria-label="' + esc(title) + '">' + miss + "</button>";
  }
  function renderMastery() {
    var p = poolObj();
    var qs = poolQuestions();
    var byFamily = {};
    p.subelements.forEach(function (s) { (byFamily[s.family] = byFamily[s.family] || []).push(s); });
    var byGroup = {};
    qs.forEach(function (q) { (byGroup[q.group] = byGroup[q.group] || []).push(q); });
    var out = [];
    (state.data.families || []).forEach(function (fam) {
      var cells = [];
      (byFamily[fam.id] || []).forEach(function (s) {
        s.groups.forEach(function (g) { (byGroup[g.id] || []).forEach(function (q) { cells.push(q); }); });
      });
      if (!cells.length) { return; }
      out.push('<div class="ham-mastery-fam"><h3>' + famDot(fam.id) + esc(fam.title) +
        '<span class="hint">' + cells.length + " questions</span></h3><div class=\"ham-mgrid\">" +
        cells.map(masteryCellHtml).join("") + "</div></div>");
    });
    $("hs-mastery").innerHTML = (out.length ? out.join("") : "<p>" + chip("neutral", ICON.neutral, "no questions") + "</p>") +
      '<div class="ham-mlegend"><span class="ham-mswatch"><i style="background:var(--sunk)"></i> not yet right</span>' +
      [1, 2, 3, 4, 5].map(function (n) {
        return '<span class="ham-mswatch"><i style="background:var(--m' + n + ')"></i> ' + n + (n === 5 ? "+" : "") + " time" + (n === 1 ? "" : "s") + " right</span>";
      }).join("") + '<span class="ham-mswatch">' + chip("critical", ICON.critical, "missed last time") + "</span></div>";
    $("hs-count").textContent = qs.length + " questions";
  }

  /* --- browse ------------------------------------------------------------- */
  function renderBrowse() {
    var box = $("hs-browse");
    var qs = filtered();
    var p = poolObj();
    var narrowed = !!(state.q.trim() || state.missedOnly || state.group);
    var byGroup = {};
    qs.forEach(function (q) { (byGroup[q.group] = byGroup[q.group] || []).push(q); });
    var out = [];
    p.subelements.forEach(function (s) {
      if (state.sub && s.id !== state.sub) { return; }
      s.groups.forEach(function (g) {
        var list = byGroup[g.id];
        if (!list) { return; }
        /* A narrowed view (search, group, missed-only) opens its groups so the
           matches are visible; the full browse view starts closed. */
        out.push('<details class="card ham-group" id="hs-g-' + esc(g.id) + '"' + (narrowed ? " open" : "") + '>' +
          '<summary><h2><span class="mono">' + esc(g.id) + "</span> " + esc(g.title) + "</h2>" +
          '<span class="count">' + list.length + " question" + (list.length === 1 ? "" : "s") + "</span></summary>" +
          '<div class="body"><ol class="ham-pills">' + list.map(pillHtml).join("") + "</ol></div></details>");
      });
    });
    box.innerHTML = out.length ? out.join("") : "<p>" + chip("neutral", ICON.neutral, "no questions match") + "</p>";
    $("hs-count").textContent = qs.length + " of " + poolQuestions().length + " questions";
  }
  function pillHtml(q) {
    return '<li class="ham-pill" data-id="' + esc(q.id) + '"><button type="button" class="ham-q" aria-expanded="false" ' +
      'aria-controls="hs-a-' + esc(q.id) + '"><span class="mono">' + esc(q.id) + "</span> " + esc(q.question) + "</button>" +
      lastMark(q.id) + '<div class="ham-a" id="hs-a-' + esc(q.id) + '" hidden>' + choicesHtml(q, null) + figureHtml(q) +
      (q.rule_ref ? '<p class="hint">FCC rule ' + esc(q.rule_ref) + "</p>" : "") + "</div></li>";
  }

  /* --- flashcards --------------------------------------------------------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function buildDeck() {
    state.deck = filtered().map(function (q) { return q.id; });
    if (state.shuffled) { shuffle(state.deck); }
    state.card = 0;
    state.answered = null;
    $("hs-count").textContent = state.deck.length + " cards";
  }
  function renderFlash() {
    var box = $("hs-flash-body");
    if (!state.deck.length) {
      box.innerHTML = "<p>" + chip("neutral", ICON.neutral, "no questions in this filter") + "</p>";
      $("hs-flash-pos").textContent = "0 / 0";
      return;
    }
    var q = state.byId[state.deck[state.card]];
    var h = '<p class="ham-flash-q"><span class="mono">' + esc(q.id) + "</span> " + esc(q.question) + "</p>" + figureHtml(q);
    if (state.showAnswer) {
      h += '<p id="hs-flash-result" role="status">' + chip("good", ICON.good, "answer " + q.correct) + "</p>" +
        choicesHtml(q, null);
    } else if (state.answered === null) {
      h += '<div class="ham-answers">' + ["A", "B", "C", "D"].map(function (k, i) {
        return '<button type="button" class="btn secondary ham-pick" data-pick="' + k + '"><span class="mono">' +
          (i + 1) + " &middot; " + k + ".</span> " + esc(q.choices[k]) + "</button>";
      }).join("") + "</div>";
    } else {
      var ok = state.answered === q.correct;
      h += '<p id="hs-flash-result" role="status">' +
        (ok ? chip("good", ICON.good, "correct") : chip("critical", ICON.critical, "wrong -- the answer is " + q.correct)) +
        "</p>" + choicesHtml(q, state.answered);
    }
    box.innerHTML = h;
    $("hs-flash-pos").textContent = (state.card + 1) + " / " + state.deck.length;
  }
  function pick(k) {
    if (state.showAnswer || state.answered !== null || !state.deck.length) { return; }
    var q = state.byId[state.deck[state.card]];
    state.answered = k;
    record(q.id, k === q.correct);
    renderFlash();
    renderProgress();
  }
  function move(d) {
    if (!state.deck.length) { return; }
    state.card = (state.card + d + state.deck.length) % state.deck.length;
    state.answered = null;
    renderFlash();
  }

  /* --- practice exam ------------------------------------------------------ */
  /* The draw: one question from each group. Every NCVEC pool states how many
   * exam questions each subelement contributes, and in all three pools that
   * number is the subelement's group count (47 CFR 97.503 sets the exam size and
   * the pools set the spread). build.py refuses to build when a
   * pool breaks that, so this cannot silently draw a wrong-sized exam. The
   * filter does not apply here: an exam is the whole pool. */
  function drawExam() {
    var p = poolObj();
    var items = [];
    p.subelements.forEach(function (s) {
      s.groups.forEach(function (g) {
        if (g.questions.length) { items.push({ sub: s.id, id: g.questions[Math.floor(Math.random() * g.questions.length)] }); }
      });
    });
    state.exam = { pool: p.pool, items: items, answers: {}, scored: false };
    $("hs-exam-score").innerHTML = "";
    renderExam();
  }
  function renderExam() {
    var p = poolObj();
    var ex = state.exam;
    $("hs-exam-scorebtn").disabled = !ex || ex.pool !== p.pool || ex.scored;
    if (!ex || ex.pool !== p.pool) {
      $("hs-exam-body").innerHTML = '<p class="hint">' + esc(p.exam_size) + " questions, one from each group; " +
        esc(p.passing_score) + " correct to pass (47 CFR 97.503). Press New exam.</p>";
      $("hs-exam-score").innerHTML = "";
      $("hs-count").textContent = p.exam_size + " exam questions";
      return;
    }
    $("hs-exam-body").innerHTML = '<ol class="ham-exam">' + ex.items.map(function (it) {
      var q = state.byId[it.id];
      var picked = ex.answers[it.id] || null;
      var inner = ex.scored ? choicesHtml(q, picked) : '<div class="ham-radios">' + ["A", "B", "C", "D"].map(function (k) {
        return '<label><input type="radio" name="hs-x-' + esc(q.id) + '" value="' + k + '"' + (picked === k ? " checked" : "") +
          '> <span class="mono">' + k + ".</span> " + esc(q.choices[k]) + "</label>";
      }).join("") + "</div>";
      return '<li class="ham-exam-q" data-id="' + esc(q.id) + '"><p><span class="mono">' + esc(q.id) + "</span> " +
        esc(q.question) + "</p>" + figureHtml(q) + inner + "</li>";
    }).join("") + "</ol>";
    var answered = Object.keys(ex.answers).length;
    $("hs-count").textContent = ex.scored ? "scored" : answered + " of " + ex.items.length + " answered";
  }
  function scoreExam() {
    var ex = state.exam;
    if (!ex || ex.scored) { return; }
    var p = poolObj();
    var right = 0, per = {}, misses = [];
    ex.items.forEach(function (it) {
      var q = state.byId[it.id];
      var a = ex.answers[it.id] || null;
      var ok = a === q.correct;
      per[it.sub] = per[it.sub] || { right: 0, total: 0 };
      per[it.sub].total += 1;
      if (ok) { right += 1; per[it.sub].right += 1; } else { misses.push({ q: q, a: a }); }
      record(q.id, ok);
    });
    ex.scored = true;
    var pass = right >= p.passing_score;
    var h = '<p id="hs-exam-result" role="status">' +
      (pass ? chip("good", ICON.good, "pass") : chip("critical", ICON.critical, "not a pass yet")) +
      ' <b class="mono">' + right + " / " + ex.items.length + '</b> <span class="hint">' + p.passing_score + " to pass</span></p>";
    h += '<table class="ham-per-sub"><thead><tr><th>subelement</th><th>title</th><th>right</th><th>of</th></tr></thead><tbody>' +
      p.subelements.map(function (s) {
        var r = per[s.id] || { right: 0, total: 0 };
        return '<tr><td class="mono">' + esc(s.id) + "</td><td>" + esc(s.title) + '</td><td class="mono">' + r.right +
          '</td><td class="mono">' + r.total + "</td></tr>";
      }).join("") + "</tbody></table>";
    if (misses.length) {
      h += '<h3>Missed (' + misses.length + ')</h3><ol class="ham-misses">' + misses.map(function (m) {
        return '<li><span class="mono">' + esc(m.q.id) + "</span> " + esc(m.q.question) + "<br>" +
          chip("good", ICON.good, "answer " + m.q.correct) + " " + esc(m.q.choices[m.q.correct]) + " " +
          (m.a ? chip("critical", ICON.critical, "you chose " + m.a) : chip("neutral", ICON.neutral, "unanswered")) + "</li>";
      }).join("") + "</ol>";
    }
    $("hs-exam-score").innerHTML = h;
    renderExam();
    renderProgress();
  }

  /* --- progress ----------------------------------------------------------- */
  function stat(n, label) { return '<div class="stat"><b>' + n + "</b><span>" + esc(label) + "</span></div>"; }
  function renderProgress() {
    var qs = poolQuestions();
    var seen = 0, right = 0, missed = 0;
    qs.forEach(function (q) {
      var r = progress[q.id];
      if (!r) { return; }
      seen += 1;
      if (r.last === "missed") { missed += 1; } else { right += 1; }
    });
    $("hs-progress").innerHTML = '<div class="stats">' + stat(qs.length, "questions") + stat(seen, "answered") +
      stat(right, "right last time") + stat(missed, "missed last time") + stat(qs.length - seen, "not yet answered") +
      "</div>" +
      (storageOk ? '<p class="hint">Kept in this browser only.</p>'
        : '<p class="hint">' + chip("warning", ICON.warning, "not saved") + " this browser blocks localStorage, so progress is forgotten on reload.</p>");
  }

  /* --- controls ----------------------------------------------------------- */
  function fillSelect(sel, items, current, allLabel) {
    sel.innerHTML = '<option value="">' + esc(allLabel) + "</option>" + items.map(function (it) {
      return '<option value="' + esc(it.id) + '"' + (it.id === current ? " selected" : "") + ">" + esc(it.id) + " &mdash; " + esc(it.title) + "</option>";
    }).join("");
  }
  function fillFilters() {
    var p = poolObj();
    fillSelect($("hs-sub"), p.subelements, state.sub, "all subelements");
    var groups = [];
    p.subelements.forEach(function (s) { if (!state.sub || s.id === state.sub) { groups = groups.concat(s.groups); } });
    if (state.group && !groups.some(function (g) { return g.id === state.group; })) { state.group = ""; }
    fillSelect($("hs-group"), groups, state.group, "all groups");
  }
  function render() {
    ["guide", "browse", "flash", "exam", "mastery"].forEach(function (m) {
      $("hs-panel-" + m).hidden = m !== state.mode;
      var tab = document.querySelector('.tab[data-mode="' + m + '"]');
      tab.setAttribute("aria-selected", String(m === state.mode));
    });
    if (state.mode === "guide") { renderGuide(); }
    if (state.mode === "browse") { renderBrowse(); }
    if (state.mode === "flash") { buildDeck(); renderFlash(); }
    if (state.mode === "exam") { renderExam(); }
    if (state.mode === "mastery") { renderMastery(); }
    renderProgress();
  }

  function wire() {
    $("hs-pool").addEventListener("change", function () { state.pool = this.value; state.sub = ""; state.group = ""; fillFilters(); render(); });
    $("hs-sub").addEventListener("change", function () { state.sub = this.value; state.group = ""; fillFilters(); render(); });
    $("hs-group").addEventListener("change", function () { state.group = this.value; render(); });
    var timer = null;
    $("hs-search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = v; render(); }, 180);
    });
    $("hs-search").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { this.value = ""; state.q = ""; render(); }
    });
    $("hs-missed").addEventListener("change", function () { state.missedOnly = this.checked; render(); });
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-mode]"), function (t) {
      t.addEventListener("click", function () { state.mode = t.getAttribute("data-mode"); render(); });
    });
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-jump]");
      if (!b) { return; }
      var kind = b.getAttribute("data-jump"), key = b.getAttribute("data-key");
      if (kind === "question") { jumpTo("guide", "hs-guide-" + key, key); }
    });
    $("hs-browse").addEventListener("click", function (e) {
      var b = e.target.closest(".ham-q");
      if (!b) { return; }
      var a = $(b.getAttribute("aria-controls"));
      var open = a.hidden;
      a.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    });
    $("hs-flash-body").addEventListener("click", function (e) {
      var b = e.target.closest(".ham-pick");
      if (b) { pick(b.getAttribute("data-pick")); }
    });
    var showBox = $("hs-flash-show");
    showBox.checked = state.showAnswer;
    showBox.addEventListener("change", function () {
      state.showAnswer = this.checked;
      saveShowAnswer(this.checked);
      state.answered = null;
      renderFlash();
    });
    $("hs-flash-prev").addEventListener("click", function () { move(-1); });
    $("hs-flash-next").addEventListener("click", function () { move(1); });
    $("hs-flash-shuffle").addEventListener("click", function () {
      state.shuffled = !state.shuffled;
      this.setAttribute("aria-pressed", String(state.shuffled));
      buildDeck();
      renderFlash();
    });
    document.addEventListener("keydown", function (e) {
      if (state.mode !== "flash" || e.altKey || e.ctrlKey || e.metaKey) { return; }
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") { return; }
      var n = ["1", "2", "3", "4"].indexOf(e.key);
      if (n >= 0) { e.preventDefault(); pick("ABCD".charAt(n)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    });
    $("hs-exam-new").addEventListener("click", drawExam);
    $("hs-exam-scorebtn").addEventListener("click", scoreExam);
    $("hs-exam-body").addEventListener("change", function (e) {
      if (!state.exam || state.exam.scored || e.target.type !== "radio") { return; }
      state.exam.answers[e.target.name.replace(/^hs-x-/, "")] = e.target.value;
      $("hs-count").textContent = Object.keys(state.exam.answers).length + " of " + state.exam.items.length + " answered";
    });
    $("hs-reset").addEventListener("click", function () {
      if (!window.confirm("Forget every answer recorded in this browser?")) { return; }
      progress = {};
      saveProgress();
      render();
    });
  }

  /* --- the pools card: what each pool is and when it is valid --------------- */
  function renderPools(pools) {
    var box = $("hs-pools");
    if (!box) { return; }
    box.innerHTML = '<div class="tbl"><table><thead><tr><th>pool</th><th>questions</th><th>exam</th><th>to pass</th><th>valid</th></tr></thead><tbody>' +
      pools.map(function (p) {
        return "<tr><td>" + esc(p.title) + '</td><td class="mono">' + p.questions + '</td><td class="mono">' + p.exam_size +
          '</td><td class="mono">' + esc(p.passing_score) + '</td><td class="mono">' + esc(p.valid_from) + " &ndash; " + esc(p.valid_to) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function fail(msg) {
    $("hs-count").textContent = "unavailable";
    $("hs-status").innerHTML = chip("neutral", "?", "UNKNOWN") + " " + esc(msg);
  }

  function start() {
    fetch(DATA_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) { throw new Error(DATA_URL + " answered HTTP " + r.status); }
      return r.json();
    }).then(function (data) {
      if (data.error) { fail("the build could not read the pools: " + data.error); return; }
      if (!data.questions || !data.questions.length) { fail("the data file has no questions"); return; }
      state.data = data;
      data.questions.forEach(function (q) { state.byId[q.id] = q; });
      injectFamilyColors(data.families);
      injectMasteryColors();
      $("hs-pool").innerHTML = data.pools.map(function (p) {
        return '<option value="' + esc(p.pool) + '">' + esc(p.title) + " (" + p.questions + ")</option>";
      }).join("");
      state.pool = data.pools[0].pool;
      renderPools(data.pools);
      fillFilters();
      wire();
      render();
    }).catch(function (e) { fail(String(e && e.message || e)); });
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
}(window, document));
