/* listen.js -- the read-along audio player for the ham study guide.
 *
 * The thirty tracks (one per subelement part, spoken answers-only) and their
 * timed lines come from /data/ham-audio.json, which build.py writes from the
 * committed .lrc files and ham-study.json. Nothing here parses an .lrc: the
 * manifest already carries each line's {t, kind, text, qid}.
 *
 * Two renderings, one stylesheet: a full player (the standalone listen.html)
 * and a compact pill (the flashcards panel of study.html). Both build the
 * same DOM with createElement/textContent -- a line's text is read aloud from
 * NCVEC question text, so it is never trusted as markup.
 *
 * Nothing here ever scrolls the page: the read-along box scrolls itself to
 * keep the current line visible, by hand, never via scrollIntoView (which
 * would walk every scrollable ancestor, including the window).
 *
 * Every read and write of localStorage is wrapped, as js/study.js does: a
 * browser that blocks storage still plays, it just forgets speed and position.
 */
(function (window, document) {
  "use strict";

  var RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var SPEED_KEY = "ham.listen.speed";
  function posKey(pool, n) { return "ham.listen.pos." + pool + "." + n; }
  function pref(key, fallback) { try { return window.localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function setPref(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* forgets */ } }
  function clearPref(key) { try { window.localStorage.removeItem(key); } catch (e) { /* forgets */ } }

  /* study.js's esc() escapes for innerHTML; this player never builds HTML, so
     the only job left is null-safety before a text node is made from it. */
  function esc(s) { return s == null ? "" : String(s); }

  /* --- building DOM without innerHTML -------------------------------------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") { n.className = attrs[k]; }
        else { n.setAttribute(k, attrs[k]); }
      });
    }
    (kids || []).forEach(function (k) { if (k) { n.appendChild(k); } });
    return n;
  }
  function text(s) { return document.createTextNode(esc(s)); }

  /* --- one player instance -------------------------------------------------
   * init() builds exactly one of these; a second init() call tears down the
   * first (its own listeners only -- never anything outside its container). */
  function Player(container, manifest, compact) {
    this.container = container;
    this.manifest = manifest;
    this.compact = compact;
    this.rate = (function () {
      var v = parseFloat(pref(SPEED_KEY, "1"));
      return RATES.indexOf(v) >= 0 ? v : 1;
    }());
    this.pool = null;
    this.track = null; /* the track object from the manifest */
    this.lineEls = [];
    this.lineIdx = -1;
    this.userPlayed = false; /* the user has pressed play at least once this page */
    this.posTimer = null;
    this.teardown = [];
    this.build();
  }
  Player.prototype.on = function (node, type, fn) {
    node.addEventListener(type, fn);
    this.teardown.push(function () { node.removeEventListener(type, fn); });
  };

  /* --- the manifest lookups ------------------------------------------------ */
  Player.prototype.albumByPool = function (pool) {
    var albums = this.manifest.albums || [];
    for (var i = 0; i < albums.length; i++) { if (albums[i].pool === pool) { return albums[i]; } }
    return null;
  };
  Player.prototype.trackByN = function (pool, n) {
    var a = this.albumByPool(pool);
    if (!a) { return null; }
    for (var i = 0; i < a.tracks.length; i++) { if (a.tracks[i].n === n) { return a.tracks[i]; } }
    return null;
  };
  Player.prototype.trackByQid = function (pool, qid) {
    var a = this.albumByPool(pool);
    if (!a) { return null; }
    for (var i = 0; i < a.tracks.length; i++) {
      var lines = a.tracks[i].lines;
      for (var j = 0; j < lines.length; j++) { if (lines[j].qid === qid) { return { track: a.tracks[i], lineIndex: j }; } }
    }
    return null;
  };
  Player.prototype.lineIndexAt = function (t) {
    var lines = this.track ? this.track.lines : [];
    var idx = -1;
    for (var i = 0; i < lines.length; i++) { if (lines[i].t <= t) { idx = i; } else { break; } }
    return idx;
  };

  /* --- shell DOM ------------------------------------------------------------
   * Full and compact share the same ids and classes (prefixed hl-), so one
   * stylesheet styles both; compact simply omits the speed group and the
   * full line list, carrying only the current and next line. */
  Player.prototype.build = function () {
    var self = this;
    this.container.textContent = "";
    this.audio = el("audio", { preload: "none", id: "hl-audio", class: "hl-audio" });

    this.titleEl = el("p", { class: "hl-title", id: "hl-title" }, [text("Choose a track to begin.")]);

    this.playBtn = el("button", { type: "button", class: "hl-btn hl-play", id: "hl-play", "aria-pressed": "false", "aria-label": "Play", disabled: "disabled" }, [text("▶")]);
    this.prevLineBtn = el("button", { type: "button", class: "hl-btn", id: "hl-prevline", "aria-label": "Previous line", disabled: "disabled" }, [text("⏮")]);
    this.nextLineBtn = el("button", { type: "button", class: "hl-btn", id: "hl-nextline", "aria-label": "Next line", disabled: "disabled" }, [text("⏭")]);
    this.prevTrackBtn = el("button", { type: "button", class: "hl-btn", id: "hl-prevtrack", "aria-label": "Previous track", disabled: "disabled" }, [text("◄◄")]);
    this.nextTrackBtn = el("button", { type: "button", class: "hl-btn", id: "hl-nexttrack", "aria-label": "Next track", disabled: "disabled" }, [text("►►")]);

    var transportKids = this.compact
      ? [this.prevLineBtn, this.playBtn, this.nextLineBtn]
      : [this.prevTrackBtn, this.prevLineBtn, this.playBtn, this.nextLineBtn, this.nextTrackBtn];
    this.transport = el("div", { class: "hl-transport", id: "hl-transport", role: "group", "aria-label": "Playback" }, transportKids);

    this.speedBtns = RATES.map(function (r) {
      var b = el("button", { type: "button", class: "hl-seg-btn", "data-rate": String(r), "aria-pressed": String(r === self.rate) }, [text((r === 1 ? "1" : String(r)) + "×")]);
      self.on(b, "click", function () { self.setSpeed(r); });
      return b;
    });
    this.speedGroup = el("div", { class: "hl-speed", id: "hl-speed", role: "group", "aria-label": "Speed" }, this.speedBtns);

    this.statusEl = el("p", { class: "hl-status", id: "hl-status", "aria-live": "polite" }, []);

    if (this.compact) {
      this.nowEl = el("p", { class: "hl-line hl-now-line", id: "hl-now" }, []);
      this.nextEl = el("p", { class: "hl-line hl-next-line", id: "hl-next" }, []);
      this.root = el("div", { class: "hl-player hl-compact", id: "hl-player" }, [
        this.audio, this.titleEl, this.transport, this.nowEl, this.nextEl, this.statusEl
      ]);
    } else {
      this.linesBox = el("ul", { class: "hl-lines", id: "hl-lines", "aria-label": "Read along" }, []);
      this.root = el("div", { class: "hl-player", id: "hl-player" }, [
        this.audio, this.titleEl, this.transport, this.speedGroup, this.linesBox, this.statusEl
      ]);
    }
    this.container.appendChild(this.root);
    this.wire();
  };

  /* --- wiring --------------------------------------------------------------- */
  Player.prototype.wire = function () {
    var self = this;
    this.on(this.playBtn, "click", function () { self.togglePlay(); });
    this.on(this.prevLineBtn, "click", function () { self.stepLine(-1); });
    this.on(this.nextLineBtn, "click", function () { self.stepLine(1); });
    this.on(this.prevTrackBtn, "click", function () { self.stepTrack(-1); });
    this.on(this.nextTrackBtn, "click", function () { self.stepTrack(1); });
    this.on(this.audio, "play", function () { self.userPlayed = true; self.playBtn.setAttribute("aria-pressed", "true"); self.playBtn.setAttribute("aria-label", "Pause"); self.playBtn.textContent = "⏸"; });
    this.on(this.audio, "pause", function () { self.playBtn.setAttribute("aria-pressed", "false"); self.playBtn.setAttribute("aria-label", "Play"); self.playBtn.textContent = "▶"; self.savePos(); });
    this.on(this.audio, "timeupdate", function () { self.tick(); });
    this.on(this.audio, "seeked", function () { self.tick(); });
    this.on(this.root, "keydown", function (e) { self.onKey(e); });
    if (this.linesBox) {
      this.on(this.linesBox, "click", function (e) {
        var li = e.target.closest ? e.target.closest(".hl-line") : null;
        if (li && li.dataset.t) { self.seekTo(parseFloat(li.dataset.t)); }
      });
    }
  };

  Player.prototype.onKey = function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) { return; }
    if (e.key === " ") { e.preventDefault(); this.togglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); this.stepLine(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); this.stepLine(1); }
    else if (e.key === "[") { e.preventDefault(); this.bumpSpeed(-1); }
    else if (e.key === "]") { e.preventDefault(); this.bumpSpeed(1); }
  };

  /* --- transport -------------------------------------------------------------*/
  Player.prototype.togglePlay = function () {
    if (!this.track) { return; }
    if (this.audio.paused) { this.audio.play().catch(function () { /* blocked; the button still reflects reality on the next event */ }); }
    else { this.audio.pause(); }
  };
  Player.prototype.stepLine = function (d) {
    if (!this.track || !this.track.lines.length) { return; }
    var idx = this.lineIndexAt(this.audio.currentTime);
    var target;
    if (d < 0) {
      /* Within a second of the line's own start, "previous" means the line
         before it; otherwise it means back to the start of this line. */
      target = (idx > 0 && this.audio.currentTime - this.track.lines[idx].t < 1) ? idx - 1 : idx;
      if (target < 0) { target = 0; }
    } else {
      target = Math.min(idx + 1, this.track.lines.length - 1);
    }
    this.seekTo(this.track.lines[Math.max(target, 0)].t);
  };
  Player.prototype.stepTrack = function (d) {
    if (!this.pool || this.track == null) { return; }
    var a = this.albumByPool(this.pool);
    if (!a) { return; }
    var i = a.tracks.indexOf(this.track);
    var nextTrack = a.tracks[i + d];
    if (nextTrack) { this.open({ pool: this.pool, n: nextTrack.n }); }
  };
  Player.prototype.seekTo = function (t) {
    var self = this;
    if (this.audio.readyState >= 1) { this.audio.currentTime = t; this.tick(); }
    else { this.on(this.audio, "loadedmetadata", function once() { self.audio.removeEventListener("loadedmetadata", once); self.audio.currentTime = t; self.tick(); }); }
  };

  /* --- speed ------------------------------------------------------------------*/
  Player.prototype.setSpeed = function (rate) {
    if (RATES.indexOf(rate) < 0) { return; }
    this.rate = rate;
    this.audio.playbackRate = rate;
    setPref(SPEED_KEY, String(rate));
    this.speedBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(parseFloat(b.getAttribute("data-rate")) === rate)); });
  };
  Player.prototype.bumpSpeed = function (d) {
    var i = RATES.indexOf(this.rate);
    var j = Math.min(Math.max(i + d, 0), RATES.length - 1);
    this.setSpeed(RATES[j]);
  };

  /* --- opening a track -------------------------------------------------------
   * Loads the manifest's mp3 as audio.src only now, never ahead of time (the
   * 104 MB rule). A track already open just seeks; a new one loads first. */
  Player.prototype.open = function (opts) {
    opts = opts || {};
    var found = null, lineIndex = -1;
    if (opts.qid != null) {
      var r = this.trackByQid(opts.pool, opts.qid);
      if (r) { found = r.track; lineIndex = r.lineIndex; }
    } else if (opts.n != null) {
      found = this.trackByN(opts.pool, opts.n);
    }
    if (!found) { this.setStatus("That track or question was not in the manifest."); return; }

    var sameTrack = this.track === found;
    this.pool = opts.pool;
    if (!sameTrack) { this.loadTrack(found, opts.qid != null ? lineIndex : null); }
    else if (lineIndex >= 0) { this.seekTo(found.lines[lineIndex].t); }

    if (this.userPlayed) { this.audio.play().catch(function () { /* autoplay blocked; leave it paused */ }); }
  };
  Player.prototype.loadTrack = function (track, lineIndex) {
    var self = this;
    this.savePos();
    this.track = track;
    /* The pool the track was loaded from: savePos keys on it, so switching
       pools in open() cannot file the outgoing track's position under the
       new pool's same-numbered track (CORRECTNESS-1, review of 2026-10-24). */
    this.trackPool = this.pool;
    this.audio.src = track.mp3;
    this.audio.playbackRate = this.rate;
    this.renderTrack();
    this.setStatus("");
    var startAt = 0;
    if (lineIndex != null && lineIndex >= 0) { startAt = track.lines[lineIndex].t; }
    else {
      var saved = parseFloat(pref(posKey(this.pool, track.n), "0"));
      if (saved > 0) { startAt = saved; }
    }
    if (startAt > 0) {
      this.on(this.audio, "loadedmetadata", function once() { self.audio.removeEventListener("loadedmetadata", once); self.audio.currentTime = startAt; self.tick(); });
    }
    this.startPosTimer();
  };
  Player.prototype.startPosTimer = function () {
    var self = this;
    if (this.posTimer) { clearInterval(this.posTimer); }
    this.posTimer = setInterval(function () { if (!self.audio.paused) { self.savePos(); } }, 5000);
  };
  Player.prototype.savePos = function () {
    var pool = this.trackPool || this.pool;
    if (!this.track || !pool) { return; }
    var t = this.audio.currentTime || 0;
    if (t > 1) { setPref(posKey(pool, this.track.n), String(t)); } else { clearPref(posKey(pool, this.track.n)); }
  };
  Player.prototype.setStatus = function (msg) { this.statusEl.textContent = msg || ""; };

  /* --- rendering a chosen track ---------------------------------------------*/
  Player.prototype.renderTrack = function () {
    var a = this.albumByPool(this.pool);
    this.titleEl.textContent = "";
    this.titleEl.appendChild(text((a ? a.label + " · " : "") + this.track.subelement.toUpperCase() + " · " + this.track.title));
    this.prevTrackBtn.disabled = !a || a.tracks.indexOf(this.track) <= 0;
    this.nextTrackBtn.disabled = !a || a.tracks.indexOf(this.track) >= a.tracks.length - 1;
    this.playBtn.disabled = false;
    this.prevLineBtn.disabled = false;
    this.nextLineBtn.disabled = false;

    if (this.linesBox) {
      this.linesBox.textContent = "";
      this.lineEls = this.track.lines.map(function (line) {
        var li = el("li", { class: "hl-line hl-line-" + line.kind }, [text(line.text)]);
        li.dataset.t = String(line.t);
        if (line.qid) { li.dataset.qid = line.qid; }
        return li;
      });
      this.lineEls.forEach(function (li) { this.linesBox.appendChild(li); }, this);
    }
    this.lineIdx = -1;
    this.tick();
  };

  /* --- the running clock: highlight + position save, every timeupdate ------ */
  Player.prototype.tick = function () {
    if (!this.track) { return; }
    var idx = this.lineIndexAt(this.audio.currentTime);
    if (idx !== this.lineIdx) {
      this.lineIdx = idx;
      if (this.lineEls.length) {
        this.lineEls.forEach(function (li, i) {
          if (i === idx) { li.setAttribute("aria-current", "true"); li.classList.add("is-now"); }
          else { li.removeAttribute("aria-current"); li.classList.remove("is-now"); }
        });
        this.keepVisible(this.lineEls[idx]);
      }
      if (this.nowEl) {
        var now = idx >= 0 ? this.track.lines[idx] : null;
        var next = idx >= 0 && idx + 1 < this.track.lines.length ? this.track.lines[idx + 1] : null;
        this.nowEl.textContent = now ? now.text : "";
        this.nextEl.textContent = next ? next.text : "";
      }
    }
  };
  /* The box scrolls itself, by hand -- never scrollIntoView, which would also
     walk the page looking for a scrollable ancestor to move. */
  Player.prototype.keepVisible = function (li) {
    var box = this.linesBox;
    if (!box || !li) { return; }
    var top = li.offsetTop, bottom = top + li.offsetHeight;
    if (top < box.scrollTop) { box.scrollTop = top; }
    else if (bottom > box.scrollTop + box.clientHeight) { box.scrollTop = bottom - box.clientHeight; }
  };

  Player.prototype.current = function () {
    return { pool: this.pool, n: this.track ? this.track.n : null, line: this.lineIdx, t: this.audio.currentTime || 0, rate: this.rate, playing: !this.audio.paused };
  };
  Player.prototype.destroy = function () {
    if (this.posTimer) { clearInterval(this.posTimer); }
    this.teardown.forEach(function (fn) { fn(); });
    this.audio.pause();
    this.audio.removeAttribute("src");
  };

  /* --- window.HamListen: the one instance a page actually holds ------------- */
  var active = null;
  var HamListen = {
    init: function (container, manifest, opts) {
      if (active) { active.destroy(); }
      active = new Player(container, manifest, !!(opts && opts.compact));
      return HamListen;
    },
    open: function (opts) { if (active) { active.open(opts || {}); } },
    setSpeed: function (rate) { if (active) { active.setSpeed(rate); } },
    current: function () { return active ? active.current() : null; }
  };
  window.HamListen = HamListen;
}(window, document));
