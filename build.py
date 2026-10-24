#!/usr/bin/env python3
"""build.py -- the data behind the study page: every question in the three
current NCVEC amateur radio question pools, from ham/pools.

The pools are one Pill (YAML) per question and a Card per group, subelement and
pool, copied unchanged from a pinned checkout (see README.md). This turns them
into data/ham-study.json, which the page reads, and copies the figures the
questions reference into data/ham-figures/. Both outputs are committed: a
release ships the committed files and never rebuilds.

It also stages and describes the read-along audio: `--stage-audio DIR` copies
the three answer albums from DIR into audio/<pool>/<nn>-<subelement>.{mp3,lrc};
the normal build then reads every audio/*/*.lrc present and writes
data/ham-audio.json, matching each spoken question line against the question
ids this same build already produced. Audio is optional -- a tree with no
audio/ ships a manifest with no albums.

WHAT IT REFUSES -- exit 2, nothing written
  * a group card that lists a question with no Pill, or a Pill no group card
    lists;
  * a group, or a pool, whose questions do not add up to its card's count;
  * a subelement whose exam question count is not its group count, or a pool
    whose subelement exam counts do not add up to its exam size. The practice
    exam draws one question from each group, which is the pools' own rule only
    while those counts agree, so a disagreement stops the build rather than
    shipping a wrong-sized exam;
  * a question without choices A-D and a key among them, or a figure the tree
    does not have;
  * a subelement that ham/families.yaml does not name, or more than eight
    families: a guide with no color is not shipped;
  * a pool with no ham/notes/<pool>.notes.v1.yaml, a glossary term that matches
    no question, a formula that lists a question the pool does not have, or a
    duplicate term or formula key. (tests/test_notes.py separately proves every
    formula's worked example and its answers against the pool.)
  * `--stage-audio DIR` when DIR does not have all three albums; it does not
    touch audio/ at all in that case. An unmatched spoken question line is a
    WARNING, not a refusal -- the audio ships with a null qid rather than not
    shipping at all.

USAGE
  build.py                   write data/ham-study.json, data/ham-figures/ and
                             data/ham-audio.json
  build.py --check           write nothing; exit 2 if the committed files
                             differ from what the pools and audio/ produce
                             (CI runs this)
  build.py --stage-audio DIR copy the three albums' .mp3/.lrc from DIR into
                             audio/, then exit (run build.py again to update
                             the manifest)

EXIT  0 OK   2 CRITICAL a count disagrees, the committed data is stale, or
      --stage-audio's DIR is missing an album
      3 usage
"""
import argparse
import json
import math
import os
import re
import shutil
import sys
from pathlib import Path, PurePosixPath

import yaml

ROOT = Path(__file__).resolve().parent
POOLS_DIR = "ham/pools"
NOTES_DIR = ROOT / "ham" / "notes"
NOTES_SCHEMA = "ham-tcos-app.notes.v1"
FAMILIES_FILE = ROOT / "ham" / "families.yaml"
JSON_OUT = ROOT / "data" / "ham-study.json"
FIGURES_OUT = ROOT / "data" / "ham-figures"
FIGURE_URL = "/data/ham-figures"
SCHEMA = "ham-tcos-app.study.v1"
FAMILIES_SCHEMA = "ham-tcos-app.families.v1"
NCVEC_POOLS = "https://ncvec.org/index.php/amateur-question-pools"
CHOICES = ("A", "B", "C", "D")

AUDIO_DIR = ROOT / "audio"
AUDIO_URL = "/audio"
AUDIO_JSON_OUT = ROOT / "data" / "ham-audio.json"
AUDIO_SCHEMA = "ham-audio/1"
AUDIO_CREDIT = ("Spoken by Kokoro from the answers-only guide; "
                "question pools NCVEC, public domain.")
# The three source albums as the dispatcher's disk names them (CONTRACT.md
# section 1) and the pool each stages into, matching data/ham-study.json.
ALBUMS = (
    {"dir": "Technician Answers - 2026-2030", "pool": "technician-2026-2030"},
    {"dir": "General Answers - 2023-2027", "pool": "general-2023-2027"},
    {"dir": "Extra Answers - 2024-2028", "pool": "extra-2024-2028"},
)
# A source file as the albums carry it, e.g. "01 - T1 - Commission's Rules.mp3".
SRC_TRACK_RE = re.compile(r"(\d{2}) - ([A-Za-z]\d) - .+\.(mp3|lrc)")
# A staged file's stem, e.g. "01-t1".
AUDIO_TRACK_RE = re.compile(r"(\d{2})-([a-z0-9]+)")
LRC_LINE_RE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
LRC_HEADER_RE = re.compile(r"^\[(ar|al|ti):(.*)\]$")
LRC_GROUP_RE = re.compile(r"^Group (\S+)\.$")

ALL_ANSWERS_RE = re.compile(r"^all(?: of)? (?:these|the above)(?: choices)?(?: are correct)?\.?$", re.I)


class Mismatch(Exception):
    """The pools disagree with their own cards, or the families map is wrong."""


class StageError(Exception):
    """A --stage-audio DIR does not have all three albums."""


def expand_answer(q):
    """(answer, answers): a plain key keeps its one answer text; an "all of the
    above" key expands to every choice, so the guide can print them all."""
    text = q["choices"][q["correct"]]
    if ALL_ANSWERS_RE.match(text.strip()):
        return None, [q["choices"][k] for k in CHOICES]
    return text, None


def read_tree(root):
    """{posix path relative to root: bytes} for every file under ham/pools."""
    base = Path(root) / POOLS_DIR
    files = {}
    for p in sorted(base.rglob("*")):
        if p.is_file():
            files[p.relative_to(root).as_posix()] = p.read_bytes()
    return files


def load_families(path):
    """({pool: {subelement id: family id}}, ordered family list)."""
    try:
        doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise Mismatch(f"{path}: not readable: {exc}")
    if not isinstance(doc, dict) or doc.get("schema") != FAMILIES_SCHEMA:
        raise Mismatch(f"{path}: schema is not {FAMILIES_SCHEMA}")
    families = doc.get("families") or []
    ids = {f["id"] for f in families}
    if len(families) > 8 or len(ids) != len(families):
        raise Mismatch(f"{path}: at most 8 families, each id unique (8 hues, fixed order)")
    by_pool = {}
    for pool, spec in (doc.get("pools") or {}).items():
        subs = {}
        for sid, row in (spec.get("subelements") or {}).items():
            if row.get("family") not in ids:
                raise Mismatch(f"{path}: {pool} {sid}: family {row.get('family')!r} is not one of {sorted(ids)}")
            subs[sid] = row["family"]
        by_pool[pool] = subs
    return by_pool, families


def load(files):
    """(pools, questions, figures {tree path: pool/name}) -- or Mismatch."""
    def doc(path):
        if path not in files:
            raise Mismatch(f"{path} is not in the tree")
        try:
            d = yaml.safe_load(files[path].decode("utf-8"))
        except (UnicodeDecodeError, yaml.YAMLError) as exc:
            raise Mismatch(f"{path}: not readable YAML: {exc}")
        if not isinstance(d, dict) or not isinstance(d.get("spec"), dict):
            raise Mismatch(f"{path}: no spec")
        return d["spec"]

    pool_cards = sorted(p for p in files if re.fullmatch(rf"{POOLS_DIR}/[^/]+/pool\.card\.v1\.yaml", p))
    if not pool_cards:
        raise Mismatch(f"no pool cards under {POOLS_DIR}")
    # License order -- Technician (element 2), General (3), Extra (4) -- not
    # alphabetical, which would open the page on Extra.
    cards = sorted(((doc(p), p) for p in pool_cards), key=lambda cp: (cp[0].get("fcc_element") or 99, cp[1]))
    pools, questions, figures = [], [], {}
    for pc, pc_path in cards:
        pool = pc.get("pool") or PurePosixPath(pc_path).parent.name
        base = f"{POOLS_DIR}/{pool}"
        listed, subs = set(), []
        for sid in pc.get("subelements") or []:
            sc = doc(f"{base}/{sid}/{sid}.card.v1.yaml")
            groups = []
            for g in sc.get("groups") or []:
                gid = g["id"]
                gc = doc(f"{base}/{sid}/{gid}/{gid}.card.v1.yaml")
                ids = [str(i) for i in gc.get("question_ids") or []]
                if len(ids) != gc.get("questions", len(ids)):
                    raise Mismatch(f"{pool} {gid}: lists {len(ids)} questions, its card says {gc.get('questions')}")
                for qid in ids:
                    questions.append(question(doc(f"{base}/{sid}/{gid}/{qid}.pill.v1.yaml"),
                                              pool, sid, gid, qid, files, figures))
                listed.update(ids)
                groups.append({"id": gid, "title": gc.get("title") or g.get("title"), "questions": ids})
            if sc.get("exam_questions") != len(groups):
                raise Mismatch(f"{pool} {sid}: {sc.get('exam_questions')} exam questions but {len(groups)} groups "
                               "-- a one-question-per-group exam would be the wrong size")
            subs.append({"id": sid, "title": sc.get("title"), "exam_questions": sc["exam_questions"],
                         "groups": groups})
        pills = {PurePosixPath(p).name[: -len(".pill.v1.yaml")]
                 for p in files if p.startswith(base + "/") and p.endswith(".pill.v1.yaml")}
        if pills != listed:
            extra, missing = sorted(pills - listed), sorted(listed - pills)
            raise Mismatch(f"{pool}: Pills no group lists {extra[:5]}, listed with no Pill {missing[:5]}")
        live = sum(len(g["questions"]) for s in subs for g in s["groups"])
        if live != pc.get("questions"):
            raise Mismatch(f"{pool}: {live} questions in its groups, its pool card says {pc.get('questions')}")
        exam = sum(s["exam_questions"] for s in subs)
        if exam != pc.get("exam_size"):
            raise Mismatch(f"{pool}: subelement exam counts add up to {exam}, its exam size is {pc.get('exam_size')}")
        withdrawn = [w.get("id") if isinstance(w, dict) else str(w) for w in pc.get("withdrawn") or []]
        pools.append({
            "pool": pool, "title": pc.get("title"), "element": pc.get("element"),
            "fcc_element": pc.get("fcc_element"),
            "valid_from": None if pc.get("valid_from") is None else str(pc["valid_from"]),
            "valid_to": None if pc.get("valid_to") is None else str(pc["valid_to"]),
            "questions": live, "withdrawn": withdrawn,
            "exam_size": pc["exam_size"], "passing_score": pc.get("passing_score"),
            "exam_rule": pc.get("exam_rule"), "exam_rule_url": pc.get("exam_rule_url"),
            "exam_draw": "one question from each group",
            "public_domain_page": (pc.get("public_domain") or {}).get("page"),
            "figures": sorted({v for v in figures.values() if v.startswith(pool + "/")}),
            "subelements": subs,
        })
    seen, dupes = set(), set()
    for q in questions:
        (dupes if q["id"] in seen else seen).add(q["id"])
    if dupes:
        # The page indexes questions by id; a repeat would show one pool's
        # question in another pool's exam.
        raise Mismatch(f"question ids repeat across pools: {sorted(dupes)[:5]}")
    return pools, questions, figures


def question(s, pool, sid, gid, qid, files, figures):
    if str(s.get("id")) != qid:
        raise Mismatch(f"{pool} {gid}: the Pill for {qid} says id {s.get('id')}")
    choices = s.get("choices") or {}
    if sorted(choices) != list(CHOICES) or s.get("correct") not in CHOICES:
        raise Mismatch(f"{pool} {qid}: needs choices A-D and a key among them")
    fig = s.get("figure")
    fig_url = fig_id = None
    if fig:
        if fig not in files:
            raise Mismatch(f"{pool} {qid}: references {fig}, which is not in the tree")
        name = PurePosixPath(fig).name
        figures[fig] = f"{pool}/{name}"
        fig_url, fig_id = f"{FIGURE_URL}/{pool}/{name}", PurePosixPath(fig).stem
    return {"id": qid, "pool": pool, "subelement": sid, "group": gid,
            "question": s.get("question"), "choices": {k: choices[k] for k in CHOICES},
            "correct": s["correct"], "rule_ref": s.get("rule_ref"),
            "figure": fig_url, "figure_id": fig_id}


def read_notes(notes_dir=NOTES_DIR):
    """{pool: parsed notes document} for every ham/notes/*.notes.v1.yaml."""
    notes = {}
    for path in sorted(Path(notes_dir).glob("*.notes.v1.yaml")):
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise Mismatch(f"{path.name}: not readable: {exc}")
        if not isinstance(doc, dict) or doc.get("schema") != NOTES_SCHEMA:
            raise Mismatch(f"{path.name}: schema is not {NOTES_SCHEMA}")
        pool = doc.get("pool")
        if not pool or pool in notes:
            raise Mismatch(f"{path.name}: needs a pool that no other notes file names")
        notes[pool] = doc
    return notes


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def attach_notes(pool, questions, doc):
    """pool["terms"] and pool["formulas"] from an authored notes document. A
    term's question ids are derived: every question whose stem or choices match
    one of the term's patterns. Everything else is authored, and refused if it
    points at nothing."""
    name = pool["pool"]
    ids = {q["id"] for q in questions}
    terms, seen = [], set()
    for t in doc.get("terms") or []:
        key = slug(str(t.get("term", "")))
        if not key or key in seen:
            raise Mismatch(f"{name}: term {t.get('term')!r} is empty or repeated")
        seen.add(key)
        if not t.get("definition") or not t.get("match"):
            raise Mismatch(f"{name}: term {t['term']!r} needs a definition and at least one match pattern")
        if not str(t.get("use") or "").strip():
            raise Mismatch(f"{name}: term {t['term']!r} needs a real-world use")
        try:
            pats = [re.compile(m, re.I) for m in t["match"]]
        except re.error as exc:
            raise Mismatch(f"{name}: term {t['term']!r}: bad pattern: {exc}")
        used = [q["id"] for q in questions
                if any(p.search(q["question"] or "") or any(p.search(c) for c in q["choices"].values()) for p in pats)]
        if not used:
            raise Mismatch(f"{name}: term {t['term']!r} matches no question")
        terms.append({"key": key, "term": t["term"], "definition": t["definition"],
                      "use": str(t["use"]).strip(), "ids": used})
    terms.sort(key=lambda t: t["term"].lower())
    formulas, seen = [], set()
    for f in doc.get("formulas") or []:
        key = f.get("key")
        if not key or key in seen:
            raise Mismatch(f"{name}: formula key {key!r} is empty or repeated")
        seen.add(key)
        missing = sorted(set(f.get("ids") or []) - ids)
        if missing:
            raise Mismatch(f"{name}: formula {key} lists questions the pool does not have: {missing[:5]}")
        for need in ("name", "use", "forms", "variables", "ids"):
            if not f.get(need):
                raise Mismatch(f"{name}: formula {key} has no {need}")
        if not (f.get("example") or {}).get("text"):
            raise Mismatch(f"{name}: formula {key} has no worked example")
        formulas.append({"key": key, "name": f["name"], "use": str(f["use"]).strip(), "forms": list(f["forms"]),
                         "variables": [{"name": str(k), "text": str(v)} for k, v in f["variables"].items()],
                         "example": f["example"]["text"], "ids": list(f["ids"])})
    pool["terms"], pool["formulas"] = terms, formulas


def build(files, families_path=FAMILIES_FILE, notes=None):
    """(document, figures) from the tree, with families, answers and, when the
    authored notes are given, each pool's glossary terms and formulas applied."""
    pools, questions, figures = load(files)
    families_by_pool, families = load_families(families_path)
    by_pool_q = {}
    for q in questions:
        by_pool_q.setdefault(q["pool"], []).append(q)
    for p in pools:
        fam_map = families_by_pool.get(p["pool"])
        if not fam_map:
            raise Mismatch(f"{p['pool']}: no family map in {families_path}")
        for sub in p["subelements"]:
            if sub["id"] not in fam_map:
                raise Mismatch(f"{p['pool']} {sub['id']}: not in {families_path}")
            sub["family"] = fam_map[sub["id"]]
        n = 0
        for q in by_pool_q.get(p["pool"], []):
            q["family"] = fam_map[q["subelement"]]
            q["answer"], q["answers"] = expand_answer(q)
            if q["answers"] is not None:
                n += 1
        p["all_of_the_above"] = n
        if notes is not None:
            if p["pool"] not in notes:
                raise Mismatch(f"{p['pool']}: no ham/notes/{p['pool']}.notes.v1.yaml")
            attach_notes(p, by_pool_q.get(p["pool"], []), notes[p["pool"]])
    if notes is not None and set(notes) - {p["pool"] for p in pools}:
        raise Mismatch(f"notes for pools that do not exist: {sorted(set(notes) - {p['pool'] for p in pools})}")
    doc = {"schema": SCHEMA,
           "credit": {"text": "Question pools: NCVEC, public domain", "url": NCVEC_POOLS},
           "pools": pools, "questions": questions, "families": families}
    return doc, figures


def collapse_ws(s):
    """Whitespace-collapsed text, for comparing an .lrc line against a
    question stem regardless of how either wraps its spaces."""
    return re.sub(r"\s+", " ", (s or "").strip())


def parse_lrc(text):
    """[{"t": seconds, "kind": "heading"|"group"|"question", "text": ...}] for
    one track's .lrc body. Header lines ([ar:], [al:], [ti:]) and blank lines
    do not match the timestamp pattern and are skipped. The first timed line
    is the heading; a line reading "Group <id>." is a group; everything else
    is a question (qid is not resolved here -- see match_qid)."""
    rows = []
    for raw in text.splitlines():
        m = LRC_LINE_RE.match(raw.strip())
        if not m:
            continue
        minutes, seconds, line_text = m.groups()
        t = round(int(minutes) * 60 + float(seconds), 2)
        line_text = line_text.strip()
        if not rows:
            kind = "heading"
        elif LRC_GROUP_RE.match(line_text):
            kind = "group"
        else:
            kind = "question"
        rows.append({"t": t, "kind": kind, "text": line_text})
    return rows


def lrc_header(text):
    """{"ar":..., "al":..., "ti":...} from an .lrc file's bracket header tags
    (whichever of the three are present)."""
    tags = {}
    for raw in text.splitlines():
        m = LRC_HEADER_RE.match(raw.strip())
        if m:
            tags[m.group(1)] = m.group(2).strip()
    return tags


def match_qid(line_text, questions):
    """The id of the question in `questions` (already filtered to one pool)
    whose question text is an exact prefix of line_text, both with whitespace
    collapsed -- a question line is its stem followed by a space and the
    answer text, and the .lrc carries no ids of its own. None if none match;
    the caller warns."""
    collapsed = collapse_ws(line_text)
    hits = [(len(stem), q["id"]) for q in questions
            for stem in [collapse_ws(q.get("question"))] if stem and collapsed.startswith(stem)]
    if not hits:
        return None
    if len(hits) > 1:
        # Two stems match when one question's text is a prefix of another's;
        # the longer stem is the line's own question. Measured 2026-10-24
        # across all three pools: zero such pairs, so this is a guard, not a
        # workaround; it says so when it ever fires.
        hits.sort(reverse=True)
        print(f"WARNING ambiguous question line {collapsed[:60]!r}: {[h[1] for h in hits]} -- taking {hits[0][1]}", file=sys.stderr)
    return max(hits)[1]


def split_question_line(line_text, question_text):
    """(q, a): question_text exactly as the study data spells it (the stem),
    and the rest of line_text after the matched stem, whitespace-trimmed (the
    spoken answer). Both inputs are already known to match via match_qid's
    whitespace-collapsed prefix comparison, so the same collapse is used here
    to find the split point."""
    stem = collapse_ws(question_text)
    rest = collapse_ws(line_text)[len(stem):].strip()
    return question_text, rest


def stage_audio(src_dir, audio_dir=AUDIO_DIR):
    """Copy the three albums' .mp3/.lrc from src_dir (laid out as the source
    disk has them, e.g. "Technician Answers - 2026-2030/01 - T1 - ....mp3")
    into audio/<pool>/<nn>-<subelement>.{mp3,lrc}, and each album's cover.jpg
    (same art embedded in every track) to audio/<pool>/cover.jpg when present;
    returns the number of files copied or already in place. Refuses
    (StageError, nothing copied) a src_dir missing any of the three albums.
    A missing cover.jpg is a WARNING, not a refusal: the page just shows no
    art for that album. Copying the same DIR again is a no-op."""
    src_dir = Path(src_dir)
    missing = [a["dir"] for a in ALBUMS if not (src_dir / a["dir"]).is_dir()]
    if missing:
        raise StageError(f"{src_dir} is missing album(s): {', '.join(missing)}")
    n = 0
    for album in ALBUMS:
        dest_dir = Path(audio_dir) / album["pool"]
        dest_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted((src_dir / album["dir"]).iterdir()):
            m = SRC_TRACK_RE.fullmatch(src.name)
            if not src.is_file() or not m:
                continue  # cover.jpg or anything not a numbered track
            nn, subelement, ext = m.group(1), m.group(2).lower(), m.group(3)
            dest = dest_dir / f"{nn}-{subelement}.{ext}"
            data = src.read_bytes()
            if not dest.is_file() or dest.read_bytes() != data:
                write_atomic(dest, data)
            n += 1
        cover_src = src_dir / album["dir"] / "cover.jpg"
        if cover_src.is_file():
            data = cover_src.read_bytes()
            dest = dest_dir / "cover.jpg"
            if not dest.is_file() or dest.read_bytes() != data:
                write_atomic(dest, data)
            n += 1
        else:
            print(f"WARNING {album['dir']} has no cover.jpg -- {album['pool']} ships with no album art", file=sys.stderr)
    return n


def build_audio(doc, audio_dir=AUDIO_DIR):
    """(manifest document, warnings) for data/ham-audio.json: every
    audio/<pool>/*.lrc present, albums ordered as doc["pools"] (license
    order), each question line matched against doc["questions"] for the same
    pool. A matched question line also carries "q" (the stem, as the study
    data spells it) and "a" (the rest of the line, the spoken answer); a line
    with no qid carries neither. An unmatched line warns rather than
    refusing. Each album also carries "cover" (/audio/<pool>/cover.jpg if
    staged beside it, else None) and "minutes" (its tracks' seconds, summed
    and rounded to the nearest minute). {"albums": []} when audio_dir does
    not exist at all."""
    audio_dir = Path(audio_dir)
    if not audio_dir.is_dir():
        return {"schema": AUDIO_SCHEMA, "credit": AUDIO_CREDIT, "albums": []}, []
    by_pool = {}
    for q in doc["questions"]:
        by_pool.setdefault(q["pool"], []).append(q)
    albums, warnings = [], []
    for p in doc["pools"]:
        pool = p["pool"]
        pool_dir = audio_dir / pool
        if not pool_dir.is_dir():
            continue
        by_id = {q["id"]: q for q in by_pool.get(pool, [])}
        tracks, album_title = [], None
        for lrc_path in sorted(pool_dir.glob("*.lrc")):
            m = AUDIO_TRACK_RE.fullmatch(lrc_path.stem)
            if not m:
                continue  # not a track name this build recognizes
            text = lrc_path.read_text(encoding="utf-8")
            tags = lrc_header(text)
            album_title = album_title or tags.get("al") or pool
            ti = tags.get("ti", "").split(" - ", 1)
            subelement = ti[0].strip() if ti and ti[0].strip() else m.group(2).upper()
            title = ti[1].strip() if len(ti) > 1 else ""
            lines = []
            for row in parse_lrc(text):
                qid = None
                if row["kind"] == "question":
                    qid = match_qid(row["text"], by_pool.get(pool, []))
                    if qid is None:
                        warnings.append(f"{pool}/{lrc_path.name} [{row['t']}]: no question matches {row['text']!r}")
                line = {"t": row["t"], "kind": row["kind"], "text": row["text"], "qid": qid}
                if qid is not None and qid in by_id:
                    line["q"], line["a"] = split_question_line(row["text"], by_id[qid]["question"])
                lines.append(line)
            seconds = math.ceil(max((r["t"] for r in lines), default=0.0))
            stem = lrc_path.stem
            tracks.append({"n": int(m.group(1)), "subelement": subelement, "title": title,
                           "mp3": f"{AUDIO_URL}/{pool}/{stem}.mp3", "lrc": f"{AUDIO_URL}/{pool}/{stem}.lrc",
                           "seconds": seconds, "lines": lines})
        if tracks:
            tracks = sorted(tracks, key=lambda t: t["n"])
            cover = pool_dir / "cover.jpg"
            albums.append({"pool": pool, "title": album_title,
                           "label": album_title.split()[0] if album_title else "",
                           "cover": f"{AUDIO_URL}/{pool}/cover.jpg" if cover.is_file() else None,
                           "minutes": round(sum(t["seconds"] for t in tracks) / 60),
                           "tracks": tracks})
    return {"schema": AUDIO_SCHEMA, "credit": AUDIO_CREDIT, "albums": albums}, warnings


def encode(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"


def write_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def write_figures(files, figures, figdir):
    """Replace DIR with exactly the referenced figures, so a figure dropped from
    the pools does not linger in the published site."""
    figdir = Path(figdir)
    tmp = figdir.with_name(f"{figdir.name}.tmp.{os.getpid()}")
    old = figdir.with_name(f"{figdir.name}.old.{os.getpid()}")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(old, ignore_errors=True)
    tmp.mkdir(parents=True)
    for src, rel in sorted(figures.items()):
        dst = tmp / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(files[src])
    if figdir.exists():
        figdir.rename(old)
    tmp.rename(figdir)
    shutil.rmtree(old, ignore_errors=True)


def drift(files, figures, data, json_out, figures_out):
    """Reasons the committed outputs differ from a fresh build; empty if none."""
    reasons = []
    json_out, figures_out = Path(json_out), Path(figures_out)
    if not json_out.is_file() or json_out.read_bytes() != data:
        reasons.append(f"{json_out.name} is not what the pools produce")
    want = {rel: files[src] for src, rel in figures.items()}
    have = ({p.relative_to(figures_out).as_posix(): p.read_bytes() for p in figures_out.rglob("*") if p.is_file()}
            if figures_out.is_dir() else {})
    for rel in sorted(set(want) | set(have)):
        if rel not in have:
            reasons.append(f"figure {rel} is missing")
        elif rel not in want:
            reasons.append(f"figure {rel} is not referenced by any question")
        elif have[rel] != want[rel]:
            reasons.append(f"figure {rel} differs from the pools")
    return reasons


def audio_drift(data, json_out=AUDIO_JSON_OUT):
    """Reasons the committed data/ham-audio.json differs from a fresh build of
    audio/; empty if none."""
    json_out = Path(json_out)
    if not json_out.is_file() or json_out.read_bytes() != data:
        return [f"{json_out.name} is not what audio/ produces"]
    return []


def main(argv=None):
    ap = argparse.ArgumentParser(prog="build.py", description="Build the study page's data from ham/pools.")
    ap.add_argument("--check", action="store_true", help="write nothing; fail if the committed data is stale")
    ap.add_argument("--stage-audio", metavar="DIR", help="copy the three answer albums from DIR into audio/, then exit")
    try:
        a = ap.parse_args(argv)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 3
    if a.stage_audio:
        try:
            n = stage_audio(a.stage_audio)
        except StageError as exc:
            print(f"CRITICAL {exc} -- nothing copied", file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"CRITICAL cannot stage audio: {exc}", file=sys.stderr)
            return 2
        print(f"OK staged {n} files into {AUDIO_DIR}")
        return 0
    try:
        files = read_tree(ROOT)
        doc, figures = build(files, notes=read_notes())
    except Mismatch as exc:
        print(f"CRITICAL {exc} -- nothing written", file=sys.stderr)
        return 2
    audio_doc, audio_warnings = build_audio(doc)
    for w in audio_warnings:
        print(f"WARNING {w}", file=sys.stderr)
    data, audio_data = encode(doc), encode(audio_doc)
    if a.check:
        reasons = drift(files, figures, data, JSON_OUT, FIGURES_OUT) + audio_drift(audio_data, AUDIO_JSON_OUT)
        if reasons:
            for r in reasons:
                print(f"CRITICAL {r} -- run: python3 build.py", file=sys.stderr)
            return 2
        print(f"OK committed data matches the pools ({len(doc['questions'])} questions, "
              f"{len(audio_doc['albums'])} albums)")
        return 0
    try:
        write_figures(files, figures, FIGURES_OUT)
        write_atomic(JSON_OUT, data)
        write_atomic(AUDIO_JSON_OUT, audio_data)
    except OSError as exc:
        print(f"CRITICAL cannot write: {exc}", file=sys.stderr)
        return 2
    if AUDIO_DIR.is_dir():
        audio_msg = f"{len(audio_doc['albums'])} albums, {sum(len(al['tracks']) for al in audio_doc['albums'])} tracks"
    else:
        audio_msg = "no audio/ directory, data/ham-audio.json has no albums"
    print(f"OK {len(doc['questions'])} questions in {len(doc['pools'])} pools, "
          f"{len(doc['families'])} families, {len(figures)} figures, "
          f"{sum(len(p['terms']) for p in doc['pools'])} terms, {sum(len(p['formulas']) for p in doc['pools'])} formulas; "
          f"{audio_msg}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
