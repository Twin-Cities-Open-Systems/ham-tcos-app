import contextlib
import io
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

    def test_notes_that_prove_nothing_are_refused(self):
        # NOTE: this test was orphaned in the file we inherited -- it sat
        # indented inside `if __name__ == "__main__":` below `unittest.main()`,
        # so it was never collected as a test. Moved back into the class.
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


class Lrc(unittest.TestCase):
    """build.parse_lrc: header lines skipped, timestamps to seconds, kinds,
    the "Group <id>." pattern."""

    def test_header_lines_are_skipped(self):
        text = ("[ar:HRV]\n[al:Technician Answers - 2026-2030]\n[ti:T1 - Commission's Rules]\n"
                "[00:00.40]Technician answers. T1 - Commission's Rules.\n")
        rows = build.parse_lrc(text)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["text"], "Technician answers. T1 - Commission's Rules.")

    def test_blank_lines_are_skipped(self):
        rows = build.parse_lrc("[ar:HRV]\n\n[00:00.40]A.\n\n")
        self.assertEqual(len(rows), 1)

    def test_timestamps_to_seconds(self):
        rows = build.parse_lrc("[00:00.40]A.\n[01:30.37]B.\n[02:01.67]C.\n")
        self.assertEqual([r["t"] for r in rows], [0.4, 90.37, 121.67])

    def test_kinds_heading_group_question(self):
        text = "[00:00.40]Heading line.\n[00:04.37]Group T1A.\n[00:06.20]A question? An answer.\n"
        rows = build.parse_lrc(text)
        self.assertEqual([r["kind"] for r in rows], ["heading", "group", "question"])

    def test_group_pattern_is_anchored(self):
        # only an exact "Group <id>." line is a group; near-misses are questions
        text = ("[00:00.40]Heading.\n[00:01.00]Group T1A.\n"
                "[00:02.00]Groups are not this.\n[00:03.00]Group T1A plus extra.\n")
        rows = build.parse_lrc(text)
        self.assertEqual([r["kind"] for r in rows], ["heading", "group", "question", "question"])


class QidMatch(unittest.TestCase):
    """build.match_qid: exact prefix after whitespace collapse; no match gives None."""

    QUESTIONS = [
        {"id": "T1A01",
         "question": "Which of the following is part of the Basis and Purpose\n  of the Amateur Radio Service?"},
        {"id": "T1A02",
         "question": "Which agency regulates and enforces the rules for the Amateur Radio Service in the United States?"},
    ]

    def test_ambiguous_prefix_takes_the_longest_stem(self):
        # CORRECTNESS-3 (2026-10-24): a stem that is a prefix of another stem
        qs = [{"id": "X1A01", "question": "What is a repeater"},
              {"id": "X1A02", "question": "What is a repeater offset"}]
        self.assertEqual(build.match_qid("What is a repeater offset The difference.", qs), "X1A02")
        self.assertEqual(build.match_qid("What is a repeater A station.", qs), "X1A01")

    def test_exact_prefix_after_whitespace_collapse(self):
        line = ("Which of the following is part of the Basis and Purpose of the Amateur Radio Service? "
                "Advancing skills in the technical and communication phases of the radio art.")
        self.assertEqual(build.match_qid(line, self.QUESTIONS), "T1A01")

    def test_no_match_gives_none(self):
        self.assertIsNone(build.match_qid("Nothing in this pool begins like this.", self.QUESTIONS))

    def test_match_is_scoped_to_the_questions_given(self):
        line = "Which agency regulates and enforces the rules for the Amateur Radio Service in the United States? The FCC."
        self.assertIsNone(build.match_qid(line, []))


class Manifest(unittest.TestCase):
    """build.build_audio: the data/ham-audio.json shape from CONTRACT.md section 2."""

    DOC = {
        "pools": [{"pool": "technician-2026-2030"}, {"pool": "general-2023-2027"}],
        "questions": [
            {"id": "T1A01", "pool": "technician-2026-2030",
             "question": "Which of the following is part of the Basis and Purpose of the Amateur Radio Service?"},
        ],
    }
    LRC = ("[ar:HRV]\n[al:Technician Answers - 2026-2030]\n[ti:T1 - Commission's Rules]\n"
           "[00:00.40]Technician answers. T1 - Commission's Rules.\n"
           "[00:04.37]Group T1A.\n"
           "[00:06.20]Which of the following is part of the Basis and Purpose of the Amateur Radio Service?"
           " Advancing skills in the technical and communication phases of the radio art.\n"
           "[00:16.92]Nothing in the study data begins like this line. An answer.\n")

    def test_no_audio_directory_gives_empty_albums(self):
        with tempfile.TemporaryDirectory() as d:
            doc, warnings = build.build_audio(self.DOC, audio_dir=Path(d) / "missing")
            self.assertEqual(doc, {"schema": build.AUDIO_SCHEMA, "credit": build.AUDIO_CREDIT, "albums": []})
            self.assertEqual(warnings, [])

    def test_manifest_shape_and_qid_match(self):
        with tempfile.TemporaryDirectory() as d:
            pool_dir = Path(d) / "technician-2026-2030"
            pool_dir.mkdir()
            (pool_dir / "01-t1.lrc").write_text(self.LRC, encoding="utf-8")
            doc, warnings = build.build_audio(self.DOC, audio_dir=Path(d))
            self.assertEqual(doc["schema"], build.AUDIO_SCHEMA)
            self.assertEqual(doc["credit"], build.AUDIO_CREDIT)
            self.assertEqual(len(doc["albums"]), 1)
            album = doc["albums"][0]
            self.assertEqual((album["pool"], album["title"], album["label"]),
                             ("technician-2026-2030", "Technician Answers - 2026-2030", "Technician"))
            self.assertEqual(len(album["tracks"]), 1)
            track = album["tracks"][0]
            self.assertEqual((track["n"], track["subelement"], track["title"]), (1, "T1", "Commission's Rules"))
            self.assertEqual(track["mp3"], "/audio/technician-2026-2030/01-t1.mp3")
            self.assertEqual(track["lrc"], "/audio/technician-2026-2030/01-t1.lrc")
            self.assertEqual(track["seconds"], 17)  # last stamp 16.92, rounded up
            self.assertEqual([l["kind"] for l in track["lines"]], ["heading", "group", "question", "question"])
            self.assertEqual([l["qid"] for l in track["lines"]], [None, None, "T1A01", None])
            self.assertEqual(len(warnings), 1)
            self.assertIn("01-t1.lrc", warnings[0])

    def test_matched_line_carries_q_and_a_unmatched_carries_neither(self):
        with tempfile.TemporaryDirectory() as d:
            pool_dir = Path(d) / "technician-2026-2030"
            pool_dir.mkdir()
            (pool_dir / "01-t1.lrc").write_text(self.LRC, encoding="utf-8")
            doc, _ = build.build_audio(self.DOC, audio_dir=Path(d))
            lines = doc["albums"][0]["tracks"][0]["lines"]
            matched = next(l for l in lines if l["qid"] == "T1A01")
            self.assertEqual(matched["q"], self.DOC["questions"][0]["question"])
            self.assertEqual(matched["a"], "Advancing skills in the technical and communication phases of the radio art.")
            unmatched = next(l for l in lines if l["kind"] == "question" and l["qid"] is None)
            self.assertNotIn("q", unmatched)
            self.assertNotIn("a", unmatched)

    def test_album_cover_is_the_staged_file_url_or_null(self):
        with tempfile.TemporaryDirectory() as d:
            pool_dir = Path(d) / "technician-2026-2030"
            pool_dir.mkdir()
            (pool_dir / "01-t1.lrc").write_text(self.LRC, encoding="utf-8")
            doc, _ = build.build_audio(self.DOC, audio_dir=Path(d))
            self.assertIsNone(doc["albums"][0]["cover"])  # no cover.jpg staged
            (pool_dir / "cover.jpg").write_bytes(b"art")
            doc, _ = build.build_audio(self.DOC, audio_dir=Path(d))
            self.assertEqual(doc["albums"][0]["cover"], "/audio/technician-2026-2030/cover.jpg")

    def test_album_minutes_sums_track_seconds_and_rounds(self):
        with tempfile.TemporaryDirectory() as d:
            pool_dir = Path(d) / "technician-2026-2030"
            pool_dir.mkdir()
            (pool_dir / "01-t1.lrc").write_text(self.LRC, encoding="utf-8")  # seconds: 17
            (pool_dir / "02-t2.lrc").write_text(
                "[00:00.40]Technician answers. T2 - Operating Procedures.\n[02:36.00]Group T2A.\n",
                encoding="utf-8")  # seconds: 156
            doc, _ = build.build_audio(self.DOC, audio_dir=Path(d))
            seconds = [t["seconds"] for t in doc["albums"][0]["tracks"]]
            self.assertEqual(seconds, [17, 156])
            self.assertEqual(doc["albums"][0]["minutes"], round(sum(seconds) / 60))


class Stage(unittest.TestCase):
    """build.stage_audio: the staging rename, from a temp DIR laid out like
    in/album-listing.txt."""

    LISTING = {
        "Technician Answers - 2026-2030": [("01", "T1", "Commission's Rules"), ("02", "T2", "Operating Procedures")],
        "General Answers - 2023-2027": [("01", "G1", "Commission's Rules")],
        "Extra Answers - 2024-2028": [("01", "E1", "Commission Rules")],
    }

    def make_tree(self, root, albums=LISTING, extra_dirs=(), covers=True):
        root = Path(root)
        for album_dir, tracks in albums.items():
            d = root / album_dir
            d.mkdir(parents=True)
            if covers:
                (d / "cover.jpg").write_bytes(b"not-audio")
            for nn, sub, title in tracks:
                (d / f"{nn} - {sub} - {title}.mp3").write_bytes(f"mp3:{nn}{sub}".encode())
                (d / f"{nn} - {sub} - {title}.lrc").write_text(f"lrc:{nn}{sub}")
        for extra in extra_dirs:
            edir = root / extra
            edir.mkdir(parents=True)
            (edir / "01 - X1 - Nope.mp3").write_bytes(b"ignored")
        return root

    def test_stages_and_renames_into_pool_directories(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
            self.make_tree(src)
            n = build.stage_audio(src, audio_dir=Path(dst))
            self.assertEqual(n, 11)  # 4 tracks across 3 albums (mp3 + lrc each) + 3 covers
            self.assertEqual((Path(dst) / "technician-2026-2030" / "01-t1.mp3").read_bytes(), b"mp3:01T1")
            self.assertTrue((Path(dst) / "general-2023-2027" / "01-g1.lrc").is_file())
            self.assertEqual((Path(dst) / "technician-2026-2030" / "cover.jpg").read_bytes(), b"not-audio")

    def test_idempotent(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
            self.make_tree(src)
            build.stage_audio(src, audio_dir=Path(dst))
            before = (Path(dst) / "technician-2026-2030" / "01-t1.mp3").read_bytes()
            n = build.stage_audio(src, audio_dir=Path(dst))
            self.assertEqual(n, 11)
            self.assertEqual((Path(dst) / "technician-2026-2030" / "01-t1.mp3").read_bytes(), before)

    def test_dir_missing_an_album_is_refused_and_nothing_copied(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
            albums = dict(self.LISTING)
            del albums["Extra Answers - 2024-2028"]
            self.make_tree(src, albums=albums)
            with self.assertRaises(build.StageError):
                build.stage_audio(src, audio_dir=Path(dst))
            self.assertEqual(list(Path(dst).iterdir()), [])

    def test_other_albums_in_dir_are_ignored(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
            self.make_tree(src, extra_dirs=["Crib Sheet - 2026-2030"])
            build.stage_audio(src, audio_dir=Path(dst))
            self.assertEqual(sorted(p.name for p in Path(dst).iterdir()),
                             ["extra-2024-2028", "general-2023-2027", "technician-2026-2030"])

    def test_missing_cover_warns_but_still_stages_tracks(self):
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
            self.make_tree(src, covers=False)
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                n = build.stage_audio(src, audio_dir=Path(dst))
            self.assertEqual(n, 8)  # the 4 tracks' mp3 + lrc; no covers to count
            self.assertFalse((Path(dst) / "technician-2026-2030" / "cover.jpg").exists())
            self.assertEqual(err.getvalue().count("WARNING"), 3)  # one per album


class CheckDrift(unittest.TestCase):
    """build.audio_drift: data/ham-audio.json drift, reported like study-data drift."""

    def test_missing_file_is_drift(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "ham-audio.json"
            self.assertEqual(build.audio_drift(b'{"a":1}\n', out), [f"{out.name} is not what audio/ produces"])

    def test_stale_file_is_drift(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "ham-audio.json"
            out.write_bytes(b'{"a":0}\n')
            self.assertEqual(build.audio_drift(b'{"a":1}\n', out), [f"{out.name} is not what audio/ produces"])

    def test_matching_file_is_not_drift(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "ham-audio.json"
            out.write_bytes(b'{"a":1}\n')
            self.assertEqual(build.audio_drift(b'{"a":1}\n', out), [])


if __name__ == "__main__":
    unittest.main()
