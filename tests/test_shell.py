import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("index.html", "study.html")
# The shared shell, owned by tcos-app (its shell.manifest). Pinned here so a file
# added or dropped upstream is a decision in this repo, not a silent change.
SHELL = [
    "css/shell.css", "js/shell.js", "js/collapse.js", "js/arrange.js",
    "js/table.js", "js/links.js", "js/freshness.js",
]
PANELS = ("guide", "browse", "flash", "exam", "glossary", "formulas", "mastery")


def tcos_app():
    for c in (os.environ.get("TCOS_APP_DIR"), str(Path.home() / "git" / "tcos-app")):
        if c and (Path(c) / "shell.manifest").is_file():
            return Path(c)
    return None


class Inheritance(unittest.TestCase):
    def test_the_shared_files_are_here(self):
        for f in SHELL:
            self.assertTrue((ROOT / f).is_file(), f)
        self.assertFalse((ROOT / "css" / "site.css").exists(), "site.css was replaced by the inherited shell.css")

    def test_copies_match_tcos_app(self):
        src = tcos_app()
        if src is None:
            self.skipTest("no tcos-app checkout (set TCOS_APP_DIR)")
        self.assertEqual((src / "shell.manifest").read_text().split(), SHELL)
        r = subprocess.run(["sh", str(ROOT / "sync-shell.sh"), "--check", str(src)], capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_pages_load_the_shell_from_their_own_origin(self):
        for page in PAGES:
            html = (ROOT / page).read_text()
            self.assertIn('href="/css/shell.css"', html, page)
            for f in SHELL:
                if f.endswith(".js"):
                    self.assertIn(f'src="/{f}"', html, f"{page} lacks {f}")
            refs = re.findall(r'(?:src|href)="(/[^"]*\.(?:js|css))"', html)
            for r in refs:
                self.assertTrue((ROOT / r.lstrip("/")).is_file(), f"{page}: {r} does not exist")
            self.assertNotRegex(html, r'<script[^>]+src="https?://', page)


class Collapsible(unittest.TestCase):
    def test_every_study_panel_is_a_collapsible_card(self):
        html = (ROOT / "study.html").read_text()
        for m in PANELS:
            sec = re.search(rf'<section class="card" id="hs-panel-{m}"[^>]*>.*?</section>', html, re.DOTALL).group(0)
            self.assertIn(f'data-tc-collapse="panel-{m}"', sec, m)
            self.assertIn("data-tc-collapse-toggle", sec, m)
            self.assertIn("data-tc-collapse-body", sec, m)

    def test_rendered_pills_are_handed_to_collapse_js(self):
        js = (ROOT / "js" / "study.js").read_text()
        for kind in ("fam-", "sub-", "grp-"):
            self.assertIn(f'data-tc-collapse="{kind}', js, kind)
        self.assertGreaterEqual(js.count("initCollapse("), 3)
        self.assertIn("openAncestors(el)", js)


class Grid(unittest.TestCase):
    """Guide, Glossary and Formulas share one column control and one grid builder."""

    def setUp(self):
        self.html = (ROOT / "study.html").read_text()
        self.js = (ROOT / "js" / "study.js").read_text()

    def test_each_grid_panel_has_the_column_control(self):
        for panel in ("guide", "glossary", "formulas"):
            for n in range(5):
                self.assertIn(f'data-cols-target="{panel}" data-cols="{n}"', self.html, (panel, n))

    def test_group_by_toggles(self):
        for panel, modes in (("guide", ("fam", "sub", "none")), ("glossary", ("az", "cat", "none"))):
            for m in modes:
                self.assertIn(f'data-groupby-target="{panel}" data-groupby="{m}"', self.html, (panel, m))
        self.assertIn('data-expand="all" data-target="hs-guide"', self.html)

    def test_one_implementation_not_three(self):
        self.assertEqual(self.js.count("function gridHtml("), 1)
        self.assertEqual(self.js.count("data-cols=\""), 1, "only gridHtml writes data-cols")
        self.assertEqual(self.js.count("COLS_KEY + panel"), 2, "one read (loadCols), one write (the handler)")
        for panel in ("guide", "glossary", "formulas"):
            self.assertIn(f'gridHtml("{panel}"', self.js)
        self.assertIn("RENDER[panel]()", self.js)

    def test_expanded_question_and_term_span_the_row(self):
        css = (ROOT / "css" / "study.css").read_text()
        self.assertIn('.ham-gcards>.ham-gcard[data-tc-collapsed="false"]', css)
        self.assertIn("grid-column:1/-1", css)

    def test_a_question_flips_between_its_stem_and_the_answer(self):
        i = self.js.index("function flipHtml")
        card = self.js[i:self.js.index("function guideCardHtml")]
        self.assertNotIn("data-tc-collapse", card)
        self.assertLess(card.index("ham-front"), card.index("ham-back"))
        self.assertIn('data-flipped="false"', card)
        g = self.js.index("function guideCardHtml")
        guide = self.js[g:self.js.index("/* --- glossary and formulas")]
        self.assertLess(guide.index("ansHtml"), guide.index("chipsHtml(q)"))
        css = (ROOT / "css" / "study.css").read_text()
        self.assertIn("backface-visibility:hidden", css)
        self.assertIn('.ham-flip[data-flipped="false"] .ham-back', css)
        self.assertIn("prefers-reduced-motion", css)

    def test_browse_questions_flip_like_the_guide_and_do_not_expand(self):
        i = self.js.index("function pillHtml")
        card = self.js[i:i + 500]
        self.assertIn("flipHtml(", card)
        self.assertIn("choicesHtml(q, null, true)", card)
        self.assertNotIn("aria-expanded", card)
        self.assertNotIn('closest(".ham-q")', self.js)

    def test_prefs_are_guarded_and_motion_is_respected(self):
        self.assertIn("try { return window.localStorage.getItem", self.js)
        self.assertIn("prefers-reduced-motion", self.js)


if __name__ == "__main__":
    unittest.main()
