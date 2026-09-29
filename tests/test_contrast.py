"""Contrast gate for everything ham paints, both themes.

Shell tokens come from css/shell.css (a byte copy of tcos-app's), the answer
palette from css/study.css, family hues from ham/families.yaml. Targets: body
text 7:1, UI text 4.5:1, borders and icons 3:1 (WCAG 2.x). `python3
tests/test_contrast.py --table` prints the palette table for a PR body.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = (ROOT / "css" / "shell.css").read_text()
STUDY = (ROOT / "css" / "study.css").read_text()
FAMILIES = (ROOT / "ham" / "families.yaml").read_text()
BODY, UI, EDGE = 7.0, 4.5, 3.0
INK_LIGHT, INK_DARK = "#fcfbf9", "#10161c"  # must match INK_LIGHT / INK_DARK in js/study.js

PAIRS = [
    ("ink", "bg", BODY, "body text on the page"),
    ("ink", "surface", BODY, "body text in a card"),
    ("ink", "sunk", BODY, "body text in a pill"),
    ("muted", "surface", BODY, "secondary text in a card"),
    ("muted", "sunk", BODY, "secondary text in a pill"),
    ("accent", "surface", BODY, "link and chip text in a card"),
    ("accent", "sunk", BODY, "link in a pill"),
    ("on-accent", "accent", BODY, "pressed toggle label"),
    ("ans-ink", "ans-bg", BODY, "correct answer text on its fill"),
    ("ans-edge", "surface", EDGE, "correct answer edge on a card"),
    ("ans-edge", "sunk", EDGE, "correct answer edge on a pill"),
    ("dim-ink", "surface", UI, "distractor text in a card"),
    ("dim-ink", "sunk", UI, "distractor text in a pill"),
    ("edge", "surface", EDGE, "pill and control borders on a card"),
    ("edge", "sunk", EDGE, "border of a control inside a pill"),
    ("ink", "surface", EDGE, "family mark outline on a card"),
    ("ink", "sunk", EDGE, "family mark outline on a pill"),
]


def tokens(text):
    return dict(re.findall(r"--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})", text))


def themes():
    light = tokens(re.search(r"\n:root\{(.*?)\n\}", SHELL, re.DOTALL).group(1))
    dark = dict(light)
    dark.update(tokens(re.search(r':root\[data-theme="dark"\]\{(.*?)\n\}', SHELL, re.DOTALL).group(1)))
    light.update(tokens(re.search(r"\n:root\{([^}]*ans-bg[^}]*)\}", STUDY).group(1)))
    dark.update(tokens(re.search(r':root\[data-theme="dark"\]\{([^}]*ans-bg[^}]*)\}', STUDY).group(1)))
    return {"light": light, "dark": dark}


def families():
    return re.findall(r'id: (\w+)\n\s+title: "([^"]+)"\n\s+hue: \w+\n\s+color: \{light: "(#\w+)", dark: "(#\w+)"\}', FAMILIES)


def lum(hexcolor):
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def best_ink(hue):
    return max((INK_LIGHT, INK_DARK), key=lambda ink: ratio(ink, hue))


class Contrast(unittest.TestCase):
    def test_every_pair_meets_its_target_in_both_themes(self):
        for name, t in themes().items():
            for fg, bg, target, use in PAIRS:
                r = ratio(t[fg], t[bg])
                self.assertGreaterEqual(r, target, f"{name}: {fg} on {bg} ({use}) is {r:.2f}, needs {target}")

    def test_family_letters_read_on_their_hue(self):
        fams = families()
        self.assertEqual(len(fams), 8)
        for fid, _title, light, dark in fams:
            for name, hue in (("light", light), ("dark", dark)):
                r = ratio(best_ink(hue), hue)
                self.assertGreaterEqual(r, UI, f"{name}: family {fid} letters on {hue} are {r:.2f}")

    def test_family_titles_give_distinct_letter_tags(self):
        tags = [title[:2] for _fid, title, _l, _d in families()]
        self.assertEqual(len(set(tags)), len(tags), tags)

    def test_js_and_test_share_the_letter_inks(self):
        js = (ROOT / "js" / "study.js").read_text()
        self.assertIn(f'INK_LIGHT = "{INK_LIGHT}", INK_DARK = "{INK_DARK}"', js)


def table():
    by = themes()
    print("| pair | use | target | light | dark |\n|---|---|---|---|---|")
    for fg, bg, target, use in PAIRS:
        print(f"| `{fg}` on `{bg}` | {use} | {target:g}:1 | {ratio(by['light'][fg], by['light'][bg]):.2f} | {ratio(by['dark'][fg], by['dark'][bg]):.2f} |")
    print("\n| family | light hue | letters | ratio | dark hue | letters | ratio |\n|---|---|---|---|---|---|---|")
    for fid, title, light, dark in families():
        li, di = best_ink(light), best_ink(dark)
        print(f"| {title} ({title[:2]}) | `{light}` | `{li}` | {ratio(li, light):.2f} | `{dark}` | `{di}` | {ratio(di, dark):.2f} |")


if __name__ == "__main__":
    if "--table" in sys.argv:
        table()
    else:
        unittest.main()
