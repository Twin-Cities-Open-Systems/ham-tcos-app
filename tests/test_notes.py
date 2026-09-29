"""Proof that the formulas on the Formulas tab are right.

Every formula in ham/notes is computed here, independently of the page: its
worked example must produce the value the notes claim, and each `checks` row
must produce the pool's own correct answer to a question that uses it. A
formula with a wrong constant, a wrong unit or a wrong rounding fails here
before it is published.
"""
import json
import math
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

PREFIX = {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "m": 1e-3, "u": 1e-6, "p": 1e-12}
NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _bits(g):
    return math.ceil(math.log2(g["ratio"]) - 1e-9)


IMPL = {
    "ohms-law": lambda g: {"i": lambda: g["e"] / g["r"], "r": lambda: g["e"] / g["i"],
                           "e": lambda: g["i"] * g["r"]}[g["solve"]](),
    "power-law": lambda g: {"p": lambda: g["e"] * g["i"], "i": lambda: g["p"] / g["e"],
                            "e": lambda: g["p"] / g["i"]}[g["solve"]](),
    "prefixes": lambda g: g["value"] * PREFIX[g["frm"]] / PREFIX[g["to"]],
    "decibels": lambda g: (10 * math.log10(g["p2"] / g["p1"]) if "p1" in g else
                           10 ** (g["db"] / 10) if g["out"] == "ratio" else
                           (1 - 10 ** (g["db"] / 10)) * 100),
    "wavelength": lambda g: 300 / g["f_mhz"],
    "antenna-length": lambda g: (468 if g["kind"] == "half" else 234) / g["f_mhz"],
    "battery-life": lambda g: g["ah"] / g["amps"],
    "duty-cycle": lambda g: (g["t_on"] / (g["t_on"] + g["t_off"]) * 100 if g.get("out") == "pct"
                             else 100 / (g["t_on"] / (g["t_on"] + g["t_off"]) * 100)),
    "swr": lambda g: max(g["z_line"], g["z_load"]) / min(g["z_line"], g["z_load"]),
    "repeater-offset": lambda g: g["f_out"] + g["offset"],
    "power-resistance": lambda g: {"p_er": lambda: g["e"] ** 2 / g["r"], "p_ir": lambda: g["i"] ** 2 * g["r"],
                                   "e_pr": lambda: math.sqrt(g["p"] * g["r"])}[g["solve"]](),
    "pep-peak-to-peak": lambda g: g["vpp"] ** 2 / (8 * g["r"]),
    "combining-components": lambda g: (sum(g["values"]) if g["mode"] == "sum"
                                       else 1 / sum(1 / v for v in g["values"])),
    "transformer": lambda g: (g["vp"] * g["ns"] / g["np"] if g["kind"] == "voltage"
                              else math.sqrt(g["z_hi"] / g["z_lo"])),
    "reactance": lambda g: (2 * math.pi * g["f"] * g["l"] if g["kind"] == "xl"
                            else 1 / (2 * math.pi * g["f"] * g["c"])),
    "fm-bandwidth": lambda g: 2 * (g["dev"] + g["fmod"]),
    "fm-multiplier": lambda g: g["dev_khz"] * g["f_osc"] / g["f_out"] * 1000,
    "sideband-edges": lambda g: ([g["carrier"] - g["bw_khz"] / 1000, g["carrier"]] if g["mode"] == "lsb"
                                 else [g["carrier"], g["carrier"] + g["bw_khz"] / 1000]),
    "efficiency": lambda g: g["p_out"] / g["p_in"] * 100,
    "resonant-frequency": lambda g: 1 / (2 * math.pi * math.sqrt(g["l"] * g["c"])),
    "circuit-q": lambda g: g["f"] / g["q"],
    "time-constant": lambda g: g["r"] * g["c"],
    "phase-angle": lambda g: abs(math.degrees(math.atan((g["xl"] - g["xc"]) / g["r"]))),
    "real-power": lambda g: g["i"] ** 2 * g["r"],
    "dbi-dbd": lambda g: g["dbi"] - 2.15,
    "erp-eirp": lambda g: g["p"] * 10 ** ((g["gain"] - sum(g["losses"])) / 10),
    "link-budget": lambda g: (lambda rx: rx - g["mds"] - g["snr"] if "mds" in g else rx)(
        g["tx"] + sum(g["gains"]) - sum(g["losses"])),
    "fm-index": lambda g: g["dev"] / g["fmod"],
    "data-bandwidth": lambda g: 4 * g["wpm"] if g["kind"] == "cw" else 1.2 * g["shift"] + g["baud"],
    "binary-counting": lambda g: {"bits": lambda: _bits(g), "levels": lambda: 2 ** g["bits"],
                                  "flipflops": lambda: math.log2(g["divide"])}[g["kind"]](),
    "q-section": lambda g: math.sqrt(g["z1"] * g["z2"]),
    "velocity-factor": lambda g: 150 * g["vf"] / g["f_mhz"],
    "op-amp-gain": lambda g: -g["vin"] * g["rf"] / g["r1"] if "vin" in g else g["rf"] / g["r1"],
    "regulator-dissipation": lambda g: (g["vin"] - g["vout"]) * g["i"],
}


def numbers(text):
    """Every number in text, as (value, decimals), reading U+2212 as a minus."""
    out = []
    for m in NUMBER.findall(text.replace("−", "-")):
        m = m.replace(",", "")
        out.append((float(m), len(m.split(".")[1]) if "." in m else 0))
    return out


def args(row):
    g = dict(row.get("given") or {})
    if "out" in row:
        g["out"] = row["out"]
    return g


def close(a, b, rel=0.011):
    return abs(a - b) <= rel * max(abs(a), abs(b), 1e-9) + 1e-9


class Notes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notes = build.read_notes()
        cls.doc = json.loads(build.JSON_OUT.read_text(encoding="utf-8"))
        cls.q = {q["id"]: q for q in cls.doc["questions"]}

    def formulas(self):
        for pool, n in sorted(self.notes.items()):
            for f in n["formulas"]:
                yield pool, f

    def test_every_pool_has_notes_and_every_formula_has_an_implementation(self):
        self.assertEqual(sorted(self.notes), sorted(p["pool"] for p in self.doc["pools"]))
        for pool, f in self.formulas():
            with self.subTest(pool=pool, formula=f["key"]):
                self.assertIn(f["key"], IMPL, "no independent implementation in this test")
        used = {f["key"] for _, f in self.formulas()}
        self.assertEqual(sorted(set(IMPL) - used), [], "implementations for formulas no pool has")

    def test_worked_examples_compute(self):
        for pool, f in self.formulas():
            ex = f["example"]
            with self.subTest(pool=pool, formula=f["key"]):
                got = IMPL[f["key"]](args(ex))
                scale = ex.get("scale", 1)
                want = ex["value"]
                if isinstance(want, list):
                    self.assertEqual(len(got), len(want))
                    for g, w in zip(got, want):
                        self.assertTrue(close(g * scale, w, 1e-6), f"{g} != {w}")
                else:
                    self.assertTrue(close(got * scale, want, 1e-4), f"computed {got * scale}, the notes say {want}")
                text = ex["text"].replace("\u2212", "-").replace(",", "")
                shown = [n for n, _ in numbers(ex["shown"])]
                vals = want if isinstance(want, list) else [want]
                for s, v in zip(shown, vals):
                    self.assertIn(f"{s:g}", text, "the stated result is not in the example text")
                    self.assertTrue(any(close(abs(s), abs(v) * k, 0.03) for k in (1, 12, 1e-3, 1e3, 1e-6, 1e6)),
                                    f"the example says {s}, the value is {v}")

    def test_checks_match_the_pools_answers(self):
        checked = 0
        for pool, f in self.formulas():
            for row in f.get("checks") or []:
                qid = row["id"]
                with self.subTest(pool=pool, formula=f["key"], question=qid):
                    self.assertIn(qid, f["ids"], "a check for a question the formula does not list")
                    q = self.q[qid]
                    self.assertEqual(q["pool"], pool)
                    got = IMPL[f["key"]](args(row))
                    scale = row.get("scale", 1)
                    if row.get("nearest"):
                        opts = {k: numbers(v)[0][0] for k, v in q["choices"].items()}
                        best = min(opts, key=lambda k: abs(opts[k] - got * scale))
                        self.assertEqual(best, q["correct"], f"{got} is nearest {best}, key is {q['correct']}")
                        checked += 1
                        continue
                    if row.get("source") == "stem":
                        want = [numbers(re.search(row["pattern"], q["question"]).group(0))[0]]
                    else:
                        want = numbers(q["choices"][q["correct"]])
                    vals = got if isinstance(got, list) else [got]
                    if row.get("pick") == "all":
                        picks = list(zip(vals, want))
                    else:
                        picks = [(vals[0], want[row.get("pick", 0)])]
                    self.assertTrue(picks, "no number in the answer")
                    for g, (w, places) in picks:
                        self.assertEqual(round(g * scale, places), round(w, places),
                                         f"{qid}: computed {g * scale}, the pool's answer is {w} "
                                         f"({q['choices'][q['correct']]!r})")
                    checked += 1
        self.assertGreater(checked, 60)

    def test_numeric_formulas_are_proved_against_a_pool_answer(self):
        # Formulas with no question whose answer they compute are allowed only
        # when named here, so a new one cannot be added unproved by accident.
        example_only = {"battery-life", "repeater-offset", "reactance", "efficiency", "duty-cycle",
                        "regulator-dissipation", "wavelength"}
        for pool, f in self.formulas():
            if not f.get("checks"):
                with self.subTest(pool=pool, formula=f["key"]):
                    self.assertIn(f["key"], example_only)

    def test_terms_are_written_for_a_reader(self):
        for pool, n in sorted(self.notes.items()):
            for t in n["terms"]:
                with self.subTest(pool=pool, term=t["term"]):
                    self.assertGreaterEqual(len(t["definition"].split()), 8)
                    self.assertTrue(t["definition"].rstrip().endswith("."))

    def test_every_use_case_is_short_and_is_not_the_definition(self):
        for pool, n in sorted(self.notes.items()):
            for kind, key, items in (("term", "term", n["terms"]), ("formula", "key", n["formulas"])):
                for x in items:
                    with self.subTest(pool=pool, **{kind: x[key]}):
                        words = len(x["use"].split())
                        self.assertTrue(6 <= words <= 40, f"{words} words")
                        self.assertNotEqual(x["use"].strip(), x.get("definition", "").strip())


if __name__ == "__main__":
    unittest.main()
