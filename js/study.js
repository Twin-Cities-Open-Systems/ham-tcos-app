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
 *   glossary    the terms the pool's questions use, searchable
 *   formulas    the pool's formulas: forms, variables, a worked example
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

  var GROUPBY_KEY = "ham-groupby-";
  var COLS_KEY = "ham-cols-";
  /* The first mode of each panel is its default. */
  var GROUP_MODES = { glossary: ["az", "cat", "none"], guide: ["fam", "sub", "none"] };
  var $ = function (id) { return document.getElementById(id); };
  function pref(key, fallback) { try { return window.localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function setPref(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* forgets */ } }
  function loadCols(panel) { var n = parseInt(pref(COLS_KEY + panel, "0"), 10); return n >= 1 && n <= 4 ? n : 0; }
  function loadGroupBy(panel) {
    var modes = GROUP_MODES[panel], g = pref(GROUPBY_KEY + panel, modes[0]);
    return modes.indexOf(g) >= 0 ? g : modes[0];
  }
  var state = {
    groupBy: { glossary: "az", guide: "fam" }, cols: { glossary: 0, formulas: 0, guide: 0, browse: 0 },
    data: null, byId: {}, pool: "", mode: "guide", sub: "", group: "", q: "", missedOnly: false, glossQ: "", refs: {},
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
  Object.keys(GROUP_MODES).forEach(function (panel) { state.groupBy[panel] = loadGroupBy(panel); });
  Object.keys(state.cols).forEach(function (panel) { state.cols[panel] = loadCols(panel); });
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
  function choicesHtml(q, picked, plain) {
    return '<ul class="ham-choices">' + ["A", "B", "C", "D"].map(function (k) {
      var cls = "", tag = "";
      if (plain) { cls = " is-plain"; }
      else if (k === q.correct) { cls = " is-correct"; tag = " " + chip("good", ICON.good, "correct"); }
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
   * into one --fam-<id> custom property per family, following css/shell.css's own
   * theming pattern (a media query for the OS setting, a [data-theme] scope
   * for the toggle, the toggle winning both ways) so the light/dark swap
   * lives in one place, and every use below references the role, not a hex. */
  function familyMap() {
    var m = {};
    (state.data.families || []).forEach(function (f) { m[f.id] = f; });
    return m;
  }
  /* The letters on a family mark are whichever of the two inks reads better on
     its hue, by WCAG contrast; tests/test_contrast.py holds the same rule to 4.5:1. */
  var INK_LIGHT = "#fbfdff", INK_DARK = "#10161c";
  function luminance(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function inkOn(hex) {
    var l = luminance(hex);
    return (luminance(INK_LIGHT) + 0.05) / (l + 0.05) >= (l + 0.05) / (luminance(INK_DARK) + 0.05) ? INK_LIGHT : INK_DARK;
  }
  function injectFamilyColors(families) {
    if (!families || !families.length) { return; }
    var light = families.map(function (f) { return "--fam-" + f.id + ":" + f.color.light + ";--fam-ink-" + f.id + ":" + inkOn(f.color.light); }).join(";");
    var dark = families.map(function (f) { return "--fam-" + f.id + ":" + f.color.dark + ";--fam-ink-" + f.id + ":" + inkOn(f.color.dark); }).join(";");
    var css = ":root{" + light + "}\n" +
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){' + dark + "}}\n" +
      ':root[data-theme="dark"]{' + dark + "}\n";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  /* The dot carries a two-letter tag (Ru, Op, Wa ...), so a family is a shape
     and letters as well as a hue -- color is never the only channel. */
  function famDot(famId) {
    var f = familyMap()[famId];
    return '<span class="ham-fam-dot" aria-hidden="true" style="--fam:var(--fam-' + esc(famId) + ');--fam-ink:var(--fam-ink-' + esc(famId) + ')">' + esc(f ? f.title.slice(0, 2) : "") + "</span>";
  }
  /* --- collapsible cards ------------------------------------------------------
   * collapse.js (the shared shell) binds [data-tc-collapse] markup once, at DOM
   * ready, so a card written later by innerHTML has to be handed to it. It has
   * no single-card call, so opening a card for a jump or a search is the same
   * two attributes it writes itself; that is not persisted, on purpose -- a
   * search result or a jump is not a choice to keep a card open. */
  function initCollapse(box) { if (window.TC && window.TC.collapse) { window.TC.collapse.init(box); } }
  function setOpen(card, open) {
    card.setAttribute("data-tc-collapsed", open ? "false" : "true");
    var head = card.querySelector("[data-tc-collapse-head]");
    if (head) { head.setAttribute("aria-expanded", String(open)); }
  }
  /* A guide card has two faces: the question and the answer. Only the visible face is
     focusable (the CSS hides the other), so focus moves with the flip. */
  function flipCard(card, toAnswer, moveFocus) {
    if (!card) { return; }
    card.setAttribute("data-flipped", String(toAnswer));
    if (moveFocus) { var n = card.querySelector(toAnswer ? ".ham-backq" : ".ham-flipbtn"); if (n) { n.focus({ preventScroll: true }); } }
  }
  function flipAll(box, toAnswer) {
    Array.prototype.forEach.call(box.querySelectorAll(".ham-flip"), function (c) { flipCard(c, toAnswer, false); });
  }
  function openAll(box) {
    Array.prototype.forEach.call(box.querySelectorAll("[data-tc-collapse]"), function (c) { setOpen(c, true); });
  }
  function openAncestors(el) {
    for (var c = el.closest("[data-tc-collapse]"); c; c = c.parentElement && c.parentElement.closest("[data-tc-collapse]")) {
      setOpen(c, true);
    }
  }

  /* --- one grid for Guide, Glossary and Formulas --------------------------------
   * Every panel that lays pills out in columns builds its list with gridHtml and
   * reads its toolbar back with syncTools, so the column control is one piece of
   * code, not three. Auto (0) is CSS: one column on a phone, two on a tablet,
   * three on a desktop. */
  function gridHtml(panel, cls, inner, bodyAttr, tag) {
    tag = tag || "ul";
    return "<" + tag + ' class="' + cls + ' ham-grid" data-cols="' + state.cols[panel] + '"' + (bodyAttr ? " data-tc-collapse-body" : "") + ">" + inner + "</" + tag + ">";
  }
  function pressGroup(selector, value, attr) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-" + attr) === value));
    });
  }
  function syncTools(panel) {
    pressGroup('[data-cols-target="' + panel + '"]', String(state.cols[panel]), "cols");
    if (GROUP_MODES[panel]) { pressGroup('[data-groupby-target="' + panel + '"]', state.groupBy[panel], "groupby"); }
  }
  var RENDER = {};

  /* --- jumping between panels ------------------------------------------------
   * A cell in the Mastery map opens the question it names: switch panel, clear whatever filter would hide it,
   * render, then scroll the target into view and flash it once. */
  function jumpTo(mode, elId, focus) {
    state.mode = mode;
    if (mode === "glossary") { state.glossQ = ""; $("hs-gloss-search").value = ""; }
    if (mode === "guide" && focus) {
      var q = state.byId[focus];
      if (q) { state.sub = q.subelement; state.group = ""; state.q = ""; state.missedOnly = false; $("hs-search").value = ""; $("hs-missed").checked = false; fillFilters(); }
    }
    render();
    requestAnimationFrame(function () {
      var el = $(elId);
      if (!el) { return; }
      openAncestors(el);
      if (el.classList.contains("ham-flip")) { flipCard(el, true, false); }
      var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      el.classList.add("is-jumped");
      setTimeout(function () { el.classList.remove("is-jumped"); }, 1600);
    });
  }

  /* --- guide: the answer first, colored by topic family --------------------
   * Default mode. Every question already carries its family and computed
   * answer(s) from build.py (families.yaml + the "all of the above"
   * rule); this only lays them out, family by family in
   * the fixed slot order, subelement by subelement, group by group. */
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function guideGroup(g, list) {
    return '<div class="ham-ggroup ham-pill" data-tc-collapse="grp-' + esc(g.id) + '"><h5 data-tc-collapse-toggle><span class="mono">' +
      esc(g.id) + "</span> " + esc(g.title) + '<span class="count">' + plural(list.length, "question") + "</span></h5>" +
      '<ul class="ham-gcards" data-tc-collapse-body>' + list.map(guideCardHtml).join("") + "</ul></div>";
  }
  /* The Guide is one tree -- family > subelement > group > question -- read
     three ways. Family (default) is the tree as authored; Subelement drops the
     family level and leads with the exam's own T1..T9 order; None is a single
     grid of every question in id order. Whatever survives the filters is what
     is drawn, so a group with no match is never an empty heading. */
  function renderGuide() {
    var box = $("hs-guide");
    var qs = filtered();
    var p = poolObj();
    var mode = state.groupBy.guide;
    syncTools("guide");
    var byGroup = {};
    qs.forEach(function (q) { (byGroup[q.group] = byGroup[q.group] || []).push(q); });
    var byFamily = {};
    p.subelements.forEach(function (s) { (byFamily[s.family] = byFamily[s.family] || []).push(s); });
    function subGroups(s) {
      var html = [], n = 0;
      s.groups.forEach(function (g) {
        var list = byGroup[g.id];
        if (!list || !list.length) { return; }
        n += list.length;
        html.push(guideGroup(g, list));
      });
      return { html: n ? gridHtml("guide", "ham-ggrid", html.join(""), false, "div") : "", n: n };
    }
    var out = [];
    if (mode === "none") {
      if (qs.length) {
        out.push(gridHtml("guide", "ham-gcards", qs.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }).map(guideCardHtml).join("")));
      }
    } else if (mode === "sub") {
      p.subelements.filter(function (s) { return !state.sub || s.id === state.sub; }).forEach(function (s) {
        var g = subGroups(s);
        if (!g.n) { return; }
        out.push('<section class="ham-fam ham-subsec" data-tc-collapse="sub-' + esc(s.id) + '" style="--fam:var(--fam-' + esc(s.family) + ')">' +
          '<div class="ham-fam-head" data-tc-collapse-toggle>' + famDot(s.family) + "<h3><span class=\"mono\">" + esc(s.id) + "</span> " + esc(s.title) + "</h3>" +
          '<span class="count">' + plural(g.n, "question") + '</span></div><div class="ham-fam-body" data-tc-collapse-body>' + g.html + "</div></section>");
      });
    } else {
      (state.data.families || []).forEach(function (fam) {
        var famQs = 0, subsHtml = [];
        (byFamily[fam.id] || []).filter(function (s) { return !state.sub || s.id === state.sub; }).forEach(function (s) {
          var g = subGroups(s);
          if (!g.n) { return; }
          famQs += g.n;
          subsHtml.push('<div class="ham-gsub"><h4><span class="mono">' + esc(s.id) + "</span> " + esc(s.title) + "</h4>" + g.html + "</div>");
        });
        if (!subsHtml.length) { return; }
        out.push('<section class="ham-fam" data-tc-collapse="fam-' + esc(fam.id) + '" style="--fam:var(--fam-' + esc(fam.id) + ')">' +
          '<div class="ham-fam-head" data-tc-collapse-toggle>' + famDot(fam.id) + "<h3>" + esc(fam.title) + "</h3>" +
          '<span class="count">' + plural(famQs, "question") + '</span></div><div class="ham-fam-body" data-tc-collapse-body>' + subsHtml.join("") + "</div></section>");
      });
    }
    box.innerHTML = out.length ? out.join("") : "<p>" + chip("neutral", ICON.neutral, "no questions match") + "</p>";
    $("hs-count").textContent = qs.length + " of " + poolQuestions().length + " questions";
    initCollapse(box);
    /* A search, group or missed-only filter is asking to see matches, not a row of closed headings. */
    if (state.q.trim() || state.group || state.missedOnly) { openAll(box); }
  }
  /* Terms and formulas per question, derived from each pool's own lists, so the
   * data file states every link once (term.ids, formula.ids) and the Guide
   * reads it back the other way. A card shows the most specific terms first --
   * a term that names few questions says more than one that names sixty --
   * and at most MAX_TERM_CHIPS of them. */
  var MAX_TERM_CHIPS = 5;
  function indexRefs(pools) {
    pools.forEach(function (p) {
      var m = {};
      function at(id) { return (m[id] = m[id] || { terms: [], formulas: [] }); }
      (p.terms || []).forEach(function (t) { t.ids.forEach(function (id) { at(id).terms.push(t); }); });
      (p.formulas || []).forEach(function (f) { f.ids.forEach(function (id) { at(id).formulas.push(f); }); });
      Object.keys(m).forEach(function (id) {
        m[id].terms.sort(function (a, b) { return a.ids.length - b.ids.length || a.term.localeCompare(b.term); });
        m[id].terms = m[id].terms.slice(0, MAX_TERM_CHIPS);
      });
      state.refs[p.pool] = m;
    });
  }
  function chipsHtml(q) {
    var r = (state.refs[q.pool] || {})[q.id];
    if (!r) { return ""; }
    var out = r.formulas.map(function (f) {
      return '<button type="button" class="ham-gchip is-formula" data-jump="formula" data-key="' + esc(f.key) + '">' + esc(f.name) + "</button>";
    }).concat(r.terms.map(function (t) {
      return '<button type="button" class="ham-gchip" data-jump="term" data-key="' + esc(t.key) + '">' + esc(t.term) + "</button>";
    }));
    return out.length ? '<p class="ham-gchips" aria-label="Terms and formulas for ' + esc(q.id) + '">' + out.join("") + "</p>" : "";
  }
  /* A collapsed question is its id and stem, nothing else; the correct answer is
     the first thing inside, filled and ticked, then the terms and formulas it
     uses. The family hue rides on the left edge and the family letter tag. */
  /* One flip card for the Guide and for Browse: the question on the front, its
     answer on the back, the same turn in both. */
  function flipHtml(q, cls, domId, mark, front, back) {
    var id = esc(q.id);
    return '<li class="' + cls + ' ham-flip" id="' + domId + '" style="--fam:var(--fam-' + esc(q.family) + ')" data-flipped="false"><div class="ham-flip-in">' +
      '<div class="ham-face ham-front"><button type="button" class="ham-flipbtn" data-flip="' + id + '" aria-label="' + id + ": " + esc(q.question) + ' Show the answer.">' +
      '<span class="ham-fq"><span class="mono">' + id + '</span> ' + esc(q.question) + mark + '</span></button>' + front +
      '<span class="ham-flip-cue" aria-hidden="true">Show answer &#8635;</span></div>' +
      '<div class="ham-face ham-back"><button type="button" class="ham-backq" data-flip="' + id + '" aria-label="' + id + ' answer. Show the question again."><span class="mono">' + id + '</span> ' +
      esc(q.question) + '<span class="ham-flip-cue" aria-hidden="true">Back &#8634;</span></button>' + back + "</div></div></li>";
  }
  function guideCardHtml(q) {
    var tick = '<span class="ham-tick" aria-hidden="true">' + ICON.good + "</span>";
    var ansHtml = q.answers
      ? '<p class="ham-gans">' + tick + ' <span class="ham-gans-lead">All of these are correct:</span></p>' +
        '<ul class="ham-gall">' + q.answers.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>"
      : '<p class="ham-gans">' + tick + " " + esc(q.answer) + "</p>";
    return flipHtml(q, "ham-gcard", "hs-guide-" + esc(q.id), "", "",
      ansHtml + chipsHtml(q) + figureHtml(q) + (q.rule_ref ? '<p class="hint">FCC rule ' + esc(q.rule_ref) + "</p>" : ""));
  }

  /* --- glossary and formulas ---------------------------------------------------
   * Every term and formula authored for this pool (ham/notes, written into the
   * data file by build.py). Each card is colored by the family of its first
   * question and lists the questions that use it; a question id jumps to that
   * question in the Guide. */
  function qButtons(ids) {
    return ids.map(function (id) {
      return '<button type="button" data-jump="question" data-key="' + esc(id) + '">' + esc(id) + "</button>";
    }).join(", ");
  }
  function famStyle(ids) {
    var q = state.byId[ids[0]];
    return q ? { dot: famDot(q.family), style: ' style="--fam:var(--fam-' + esc(q.family) + ')"' } : { dot: "", style: "" };
  }
  /* Every term is a pill (same look as a Browse question) in a CSS grid. The
     reader picks how they are grouped -- A-Z, by topic family, or not at all --
     and how many columns; each group is itself a collapsible card. */
  function termPill(term, tag) {
    var f = famStyle(term.ids);
    return '<li class="ham-term ham-pill"' + f.style + ' id="hs-term-' + esc(term.key) + '" data-tc-collapse="term-' + esc(term.key) +
      '" data-tc-collapse-default="collapsed"><h3 data-tc-collapse-toggle>' + f.dot + esc(term.term) + (tag || "") +
      '</h3><div data-tc-collapse-body><p>' + esc(term.definition) + '</p><p class="ham-refqs">Used in: ' + qButtons(term.ids) +
      "</p></div></li>";
  }
  function termFamilies(term) {
    var seen = [];
    term.ids.forEach(function (id) {
      var q = state.byId[id];
      if (q && seen.indexOf(q.family) < 0) { seen.push(q.family); }
    });
    return seen;
  }
  function famTag(term) {
    var fams = termFamilies(term), fm = familyMap();
    if (!fams.length || !fm[fams[0]]) { return ""; }
    var also = fams.slice(1).filter(function (id) { return fm[id]; }).map(function (id) { return fm[id].title; });
    return '<span class="ham-famtag"' + (also.length ? ' title="Also used in: ' + esc(also.join(", ")) + '"' : "") + ">" +
      esc(fm[fams[0]].title) + (also.length ? " +" + also.length : "") + "</span>";
  }
  function groupCard(id, headHtml, count, inner) {
    return '<section class="ham-tgroup" data-tc-collapse="' + esc(id) + '"><h4 data-tc-collapse-toggle>' + headHtml +
      '<span class="count">' + count + " term" + (count === 1 ? "" : "s") + "</span></h4>" +
      gridHtml("glossary", "ham-terms", inner, true) + "</section>";
  }
  function groupTerms(terms) {
    var mode = state.groupBy.glossary, fm = familyMap();
    if (mode === "none") { return null; }
    var buckets = {}, order = [];
    terms.forEach(function (term) {
      var key;
      if (mode === "cat") {
        var q = state.byId[term.ids[0]];
        key = q && fm[q.family] ? q.family : "other";
      } else {
        var ch = term.term.charAt(0).toUpperCase();
        key = /[A-Z]/.test(ch) ? ch : "#";
      }
      if (!buckets[key]) { buckets[key] = []; order.push(key); }
      buckets[key].push(term);
    });
    if (mode === "cat") {
      var rank = {};
      (state.data.families || []).forEach(function (f, i) { rank[f.id] = i; });
      order.sort(function (x, y) { return (x in rank ? rank[x] : 99) - (y in rank ? rank[y] : 99); });
    } else {
      order.sort();
    }
    return order.map(function (key) {
      var head = mode === "cat" ? (key === "other" ? "Other" : famDot(key) + esc(fm[key].title)) : esc(key);
      return groupCard("tg-" + mode + "-" + key, head, buckets[key].length,
        buckets[key].map(function (term) { return termPill(term, mode === "cat" ? famTag(term) : ""); }).join(""));
    }).join("");
  }
  function renderGlossary() {
    var all = poolObj().terms || [];
    var t = (state.glossQ || "").trim().toLowerCase();
    var terms = (t ? all.filter(function (x) {
      return x.term.toLowerCase().indexOf(t) >= 0 || x.definition.toLowerCase().indexOf(t) >= 0;
    }) : all).slice().sort(function (a, b) { return a.term.localeCompare(b.term); });
    $("hs-glossary-count").textContent = terms.length + " of " + all.length + " terms";
    $("hs-count").textContent = all.length + " terms";
    syncTools("glossary");
    if (!terms.length) {
      $("hs-glossary").innerHTML = "<p>" + chip("neutral", ICON.neutral, all.length ? "no terms match" : "no terms for this pool") + "</p>";
      return;
    }
    var grouped = groupTerms(terms);
    $("hs-glossary").innerHTML = grouped !== null ? grouped :
      gridHtml("glossary", "ham-terms", terms.map(function (term) { return termPill(term, ""); }).join(""));
    initCollapse($("hs-glossary"));
    /* A search shows its matches: every group that survived the filter holds one, so open them all. */
    if (t) { openAll($("hs-glossary")); }
  }
  /* Ohm's law and the power law get the classic triangle, plain inline SVG:
     the only figure this page draws. Only where the formula's variables are
     the three letters, so a pool that names them differently gets no wrong one. */
  var TRIANGLES = { "ohms-law": ["E", "I", "R"], "power-law": ["P", "I", "E"] };
  function triangleSvg(top, left, right) {
    /* The letters are HTML over the SVG lines, not SVG text: a browser's forced-dark
       mode recolors HTML text but leaves SVG text dark, which vanishes on the dark card. */
    return '<span class="ham-formula-tri" role="img" aria-label="Triangle: ' + esc(top) + " over " + esc(left) + " and " + esc(right) + '">' +
      '<svg viewBox="0 0 160 140" width="160" height="140" aria-hidden="true" focusable="false">' +
      '<polygon points="80,8 8,132 152,132" fill="none" stroke="var(--edge)" stroke-width="2"/>' +
      '<line x1="8" y1="70" x2="152" y2="70" stroke="var(--edge)" stroke-width="2"/>' +
      '<line x1="80" y1="8" x2="80" y2="132" stroke="var(--edge)" stroke-width="2"/></svg>' +
      '<span class="ham-tri-l" style="left:50%;top:22px">' + esc(top) + "</span>" +
      '<span class="ham-tri-l" style="left:27.5%;top:82px">' + esc(left) + "</span>" +
      '<span class="ham-tri-l" style="left:72.5%;top:82px">' + esc(right) + "</span></span>";
  }
  function renderFormulas() {
    var formulas = poolObj().formulas || [];
    $("hs-formulas-count").textContent = formulas.length + " formulas";
    $("hs-count").textContent = formulas.length + " formulas";
    if (!formulas.length) {
      $("hs-formulas").innerHTML = "<p>" + chip("neutral", ICON.neutral, "no formulas for this pool") + "</p>";
      return;
    }
    syncTools("formulas");
    $("hs-formulas").innerHTML = gridHtml("formulas", "ham-formulas", formulas.map(function (f) {
      var fam = famStyle(f.ids);
      var names = f.variables.map(function (v) { return v.name; });
      var tri = TRIANGLES[f.key] && TRIANGLES[f.key].every(function (v) { return names.indexOf(v) >= 0; })
        ? triangleSvg(TRIANGLES[f.key][0], TRIANGLES[f.key][1], TRIANGLES[f.key][2]) : "";
      var vars = f.variables.length ? '<table class="ham-formula-vars"><tbody>' + f.variables.map(function (v) {
        return "<tr><td>" + esc(v.name) + "</td><td>" + esc(v.text) + "</td></tr>";
      }).join("") + "</tbody></table>" : "";
      return '<li class="ham-formula ham-pill"' + fam.style + ' id="hs-formula-' + esc(f.key) + '" data-tc-collapse="formula-' + esc(f.key) +
        '"><h3 data-tc-collapse-toggle>' + fam.dot + esc(f.name) +
        '</h3><div data-tc-collapse-body><p class="ham-formula-forms">' + f.forms.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") +
        "</p>" + tri + vars + '<p class="ham-example"><b>Example</b> ' + esc(f.example) + '</p><p class="ham-refqs">Used in: ' +
        qButtons(f.ids) + "</p></div></li>";
    }).join(""));
    initCollapse($("hs-formulas"));
  }

  /* --- mastery map -------------------------------------------------------------
   * One square per question, grouped into the same collapsible family cards as
   * the Guide. The fill is a one-hue ramp by times answered right, tokens
   * --m1..--m5 in css/study.css, designed per theme (magnitude always moves away
   * from the card: darker on light, lighter on dark). Color is never alone: each
   * square prints its count (0 = seen, none right yet; blank = not seen), and a
   * corner mark says "missed last time". tests/test_contrast.py holds the ramp. */
  function masteryCount(id) {
    var r = progress[id];
    if (!r || !r.seen) { return -1; }
    return Math.min(r.correct || 0, 5);
  }
  function masteryCellHtml(q) {
    var n = masteryCount(q.id);
    var r = progress[q.id];
    var missed = r && r.last === "missed";
    var ans = q.answers ? "all of the above" : q.answer;
    var title = q.id + " -- " + ans + (r ? " (" + r.correct + "/" + r.seen + " right" + (missed ? ", missed last time" : "") + ")" : " (not yet seen)");
    return '<button type="button" class="ham-mcell" data-jump="question" data-key="' + esc(q.id) + '" data-n="' + n + '"' +
      ' title="' + esc(title) + '" aria-label="' + esc(title) + '"><span aria-hidden="true">' + (n < 0 ? "" : n === 5 ? "5+" : n) + "</span>" +
      (missed ? '<span class="ham-mmiss" aria-hidden="true">' + ICON.critical + "</span>" : "") + "</button>";
  }
  function masterySample(n, label) {
    return '<span class="ham-mswatch"><span class="ham-mcell ham-msample" data-n="' + n + '" aria-hidden="true">' + (n < 0 ? "" : n === 5 ? "5+" : n) + "</span> " + label + "</span>";
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
      var right = cells.filter(function (q) { return masteryCount(q.id) > 0; }).length;
      out.push('<section class="ham-fam" data-tc-collapse="mfam-' + esc(fam.id) + '" style="--fam:var(--fam-' + esc(fam.id) + ')">' +
        '<div class="ham-fam-head" data-tc-collapse-toggle>' + famDot(fam.id) + "<h3>" + esc(fam.title) + "</h3>" +
        '<span class="count">' + right + " of " + plural(cells.length, "question") + ' right</span></div>' +
        '<div class="ham-fam-body" data-tc-collapse-body><div class="ham-mgrid">' + cells.map(masteryCellHtml).join("") + "</div></div></section>");
    });
    var legend = '<div class="ham-mlegend"><span class="ham-mlegend-h">Times answered right</span>' +
      masterySample(-1, "not seen") + masterySample(0, "seen, none right") +
      [1, 2, 3, 4, 5].map(function (n) { return masterySample(n, n === 5 ? "5 or more" : String(n)); }).join("") +
      '<span class="ham-mswatch"><span class="ham-mmark" aria-hidden="true">' + ICON.critical + "</span> missed last time</span></div>";
    $("hs-mastery").innerHTML = (out.length ? '<div class="hs-tools"><div class="hs-seg"><button class="btn secondary" type="button" data-expand="all" data-target="hs-mastery">Expand all</button> ' +
      '<button class="btn secondary" type="button" data-expand="none" data-target="hs-mastery">Collapse all</button></div></div>' + legend + out.join("") : "<p>" + chip("neutral", ICON.neutral, "no questions") + "</p>");
    initCollapse($("hs-mastery"));
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
    syncTools("browse");
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
    box.innerHTML = out.length ? gridHtml("browse", "ham-bgrid", out.join(""), false, "div") : "<p>" + chip("neutral", ICON.neutral, "no questions match") + "</p>";
    $("hs-count").textContent = qs.length + " of " + poolQuestions().length + " questions";
  }
  function pillHtml(q) {
    return flipHtml(q, "ham-bcard", "hs-q-" + esc(q.id), lastMark(q.id), choicesHtml(q, null, true) + figureHtml(q),
      choicesHtml(q, null) + figureHtml(q) + (q.rule_ref ? '<p class="hint">FCC rule ' + esc(q.rule_ref) + "</p>" : ""));
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
    /* Memorize and quiz look different at a glance: a solid green rail and a star
       versus a dashed blue rail and a question mark, each named in words. */
    box.className = "ham-flash " + (state.showAnswer ? "is-memorize" : "is-quiz");
    var h = '<p class="ham-mode"><span aria-hidden="true">' + (state.showAnswer ? "\u2605" : "?") + "</span> " +
      (state.showAnswer ? "Memorize: answers shown" : "Quiz: pick an answer") + "</p>" +
      '<p class="ham-flash-q"><span class="mono">' + esc(q.id) + "</span> " + esc(q.question) + "</p>" + figureHtml(q);
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
  RENDER.guide = renderGuide; RENDER.glossary = renderGlossary; RENDER.formulas = renderFormulas; RENDER.browse = renderBrowse;
  function render() {
    ["guide", "browse", "flash", "exam", "glossary", "formulas", "mastery"].forEach(function (m) {
      $("hs-panel-" + m).hidden = m !== state.mode;
      var tab = document.querySelector('.tab[data-mode="' + m + '"]');
      tab.setAttribute("aria-selected", String(m === state.mode));
    });
    if (state.mode === "guide") { renderGuide(); }
    if (state.mode === "browse") { renderBrowse(); }
    if (state.mode === "flash") { buildDeck(); renderFlash(); }
    if (state.mode === "exam") { renderExam(); }
    if (state.mode === "glossary") { renderGlossary(); }
    if (state.mode === "formulas") { renderFormulas(); }
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
      t.addEventListener("click", function () {
        state.mode = t.getAttribute("data-mode"); render();
        /* Choosing a tab is asking to see it, whatever the panel was last left as. */
        setOpen($("hs-panel-" + state.mode), true);
      });
    });
    var glossTimer = null;
    $("hs-gloss-search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(glossTimer);
      glossTimer = setTimeout(function () { state.glossQ = v; renderGlossary(); }, 180);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-groupby-target]"), function (b) {
      b.addEventListener("click", function () {
        var panel = b.getAttribute("data-groupby-target");
        state.groupBy[panel] = b.getAttribute("data-groupby"); setPref(GROUPBY_KEY + panel, state.groupBy[panel]); RENDER[panel]();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-cols-target]"), function (b) {
      b.addEventListener("click", function () {
        var panel = b.getAttribute("data-cols-target"), n = parseInt(b.getAttribute("data-cols"), 10);
        state.cols[panel] = n; setPref(COLS_KEY + panel, String(n));
        RENDER[panel]();
      });
    });
    document.addEventListener("click", function (e) {
      var f = e.target.closest("[data-flip]");
      if (!f && !e.target.closest("a, button, input, select, textarea")) { f = e.target.closest(".ham-front"); }
      if (f) { flipCard(f.closest(".ham-flip"), !f.closest(".ham-back"), true); return; }
      var fa = e.target.closest("[data-flipall]");
      if (fa) { flipAll($(fa.getAttribute("data-target")), fa.getAttribute("data-flipall") === "answers"); return; }
      var x = e.target.closest("[data-expand]");
      if (x && window.TC && window.TC.collapse) {
        var target = $(x.getAttribute("data-target"));
        if (x.getAttribute("data-expand") === "all") { window.TC.collapse.expandAll(target); } else { window.TC.collapse.collapseAll(target); }
        return;
      }
      var b = e.target.closest("[data-jump]");
      if (!b) { return; }
      var kind = b.getAttribute("data-jump"), key = b.getAttribute("data-key");
      if (kind === "term") { jumpTo("glossary", "hs-term-" + key); }
      if (kind === "formula") { jumpTo("formulas", "hs-formula-" + key); }
      if (kind === "question") { jumpTo("guide", "hs-guide-" + key, key); }
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
      indexRefs(data.pools);
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
