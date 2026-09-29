import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class Tree(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = build.read_tree(ROOT)

    def test_expand_answer_plain_and_all_of_the_above(self):
        q = {"choices": {"A": "x", "B": "y", "C": "z", "D": "All of these choices are correct"}, "correct": "B"}
        self.assertEqual(build.expand_answer(q), ("y", None))
        q["correct"] = "D"
        self.assertEqual(build.expand_answer(q), (None, ["x", "y", "z", "All of these choices are correct"]))

    def test_committed_data_matches_pools(self):
        doc, figures = build.build(self.files, notes=build.read_notes())
        self.assertEqual(len(doc["questions"]), 1431)
        self.assertEqual(len(doc["pools"]), 3)
        self.assertEqual(len(figures), 14)
        self.assertEqual(build.drift(self.files, figures, build.encode(doc), build.JSON_OUT, build.FIGURES_OUT), [])

    def test_dropped_question_is_refused(self):
        pill = next(p for p in sorted(self.files) if p.endswith(".pill.v1.yaml"))
        files = {k: v for k, v in self.files.items() if k != pill}
        with self.assertRaises(build.Mismatch):
            build.build(files)

    def test_unknown_family_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "families.yaml"
            bad.write_text((ROOT / "ham" / "families.yaml").read_text().replace("family: ", "family: nope-", 1))
            with self.assertRaises(build.Mismatch):
                build.build(self.files, bad)

    def test_drift_is_reported(self):
        doc, figures = build.build(self.files)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "study.json"
            out.write_bytes(b"{}\n")
            reasons = build.drift(self.files, figures, build.encode(doc), out, Path(d) / "figs")
            self.assertTrue(any("not what the pools produce" in r for r in reasons))
            self.assertTrue(any("is missing" in r for r in reasons))


if __name__ == "__main__":
    unittest.main()

    def test_notes_that_prove_nothing_are_refused(self):
        import copy

        def broken(mutate):
            notes = copy.deepcopy(build.read_notes())
            mutate(notes[sorted(notes)[0]])
            return notes

        cases = {
            "a term matching no question": lambda n: n["terms"].append(
                {"term": "Zzz", "definition": "Nothing uses this.", "use": "Never.", "match": ["zzzqqq"]}),
            "a term with no real-world use": lambda n: n["terms"][0].pop("use"),
            "a formula with no real-world use": lambda n: n["formulas"][0].pop("use"),
            "a formula listing an unknown question": lambda n: n["formulas"][0]["ids"].append("X9X99"),
            "a repeated term": lambda n: n["terms"].append(dict(n["terms"][0])),
        }
        for name, mutate in cases.items():
            with self.subTest(name):
                with self.assertRaises(build.Mismatch):
                    build.build(self.files, notes=broken(mutate))
        with self.subTest("a pool without notes"):
            notes = build.read_notes()
            notes.pop(sorted(notes)[0])
            with self.assertRaises(build.Mismatch):
                build.build(self.files, notes=notes)
