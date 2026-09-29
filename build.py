#!/usr/bin/env python3
"""build.py -- the data behind the study page: every question in the three
current NCVEC amateur radio question pools, from ham/pools.

The pools are one Pill (YAML) per question and a Card per group, subelement and
pool, copied unchanged from a pinned checkout (see README.md). This turns them
into data/ham-study.json, which the page reads, and copies the figures the
questions reference into data/ham-figures/. Both outputs are committed: a
release ships the committed files and never rebuilds.

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

USAGE
  build.py           write data/ham-study.json and data/ham-figures/
  build.py --check   write nothing; exit 2 if the committed files differ from
                     what the pools produce (CI runs this)

EXIT  0 OK   2 CRITICAL a count disagrees, or the committed data is stale
      3 usage
"""
import argparse
import json
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

ALL_ANSWERS_RE = re.compile(r"^all(?: of)? (?:these|the above)(?: choices)?(?: are correct)?\.?$", re.I)


class Mismatch(Exception):
    """The pools disagree with their own cards, or the families map is wrong."""


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


def main(argv=None):
    ap = argparse.ArgumentParser(prog="build.py", description="Build the study page's data from ham/pools.")
    ap.add_argument("--check", action="store_true", help="write nothing; fail if the committed data is stale")
    try:
        a = ap.parse_args(argv)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 3
    try:
        files = read_tree(ROOT)
        doc, figures = build(files, notes=read_notes())
    except Mismatch as exc:
        print(f"CRITICAL {exc} -- nothing written", file=sys.stderr)
        return 2
    data = encode(doc)
    if a.check:
        reasons = drift(files, figures, data, JSON_OUT, FIGURES_OUT)
        if reasons:
            for r in reasons:
                print(f"CRITICAL {r} -- run: python3 build.py", file=sys.stderr)
            return 2
        print(f"OK committed data matches the pools ({len(doc['questions'])} questions)")
        return 0
    try:
        write_figures(files, figures, FIGURES_OUT)
        write_atomic(JSON_OUT, data)
    except OSError as exc:
        print(f"CRITICAL cannot write: {exc}", file=sys.stderr)
        return 2
    print(f"OK {len(doc['questions'])} questions in {len(doc['pools'])} pools, "
          f"{len(doc['families'])} families, {len(figures)} figures, "
          f"{sum(len(p['terms']) for p in doc['pools'])} terms, {sum(len(p['formulas']) for p in doc['pools'])} formulas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
