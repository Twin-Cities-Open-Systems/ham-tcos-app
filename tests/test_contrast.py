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
INK_LIGHT, INK_DARK = "#fbfdff", "#10161c"  # must match INK_LIGHT / INK_DARK in js/study.js

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
    ("critical-ink", "surface", EDGE, "missed-last-time mark on a card"),
    ("ink", "sunk", BODY, "count on a seen-but-none-right mastery square"),
]
RAMP = ["m1", "m2", "m3", "m4", "m5"]
STEP = 1.3  # adjacent ramp steps differ by at least this contrast ratio, so every step can be told apart
for _m in RAMP:
    PAIRS += [
        (f"{_m}-ink", _m, UI, f"count on mastery step {_m[1]}"),
        (_m, "surface", EDGE, f"mastery step {_m[1]} against a card"),
        (_m, "sunk", EDGE, f"mastery step {_m[1]} against a pill"),
    ]


def tokens(text):
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})", text))


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

    def test_mastery_ramp_steps_are_distinguishable_and_monotonic(self):
        for name, t in themes().items():
            lums = [lum(t[m]) for m in RAMP]
            self.assertEqual(lums, sorted(lums, reverse=(name == "light")), f"{name}: ramp must move away from the card")
            for a, b in zip(RAMP, RAMP[1:]):
                r = ratio(t[a], t[b])
                self.assertGreaterEqual(r, STEP, f"{name}: {a} vs {b} is {r:.2f}, needs {STEP}")

    def test_mastery_ramp_is_the_same_in_both_dark_blocks(self):
        dark_auto = re.search(r'prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{(.*?)\}\}', STUDY, re.DOTALL).group(1)
        dark_set = re.search(r':root\[data-theme="dark"\]\{(.*?)\}', STUDY, re.DOTALL).group(1)
        self.assertEqual(tokens(dark_auto), tokens(dark_set))

    def test_js_and_test_share_the_letter_inks(self):
        js = (ROOT / "js" / "study.js").read_text()
        self.assertIn(f'INK_LIGHT = "{INK_LIGHT}", INK_DARK = "{INK_DARK}"', js)


def table():
    by = themes()
    print("| pair | use | target | light | dark |\n|---|---|---|---|---|")
    for fg, bg, target, use in PAIRS:
        print(f"| `{fg}` on `{bg}` | {use} | {target:g}:1 | {ratio(by['light'][fg], by['light'][bg]):.2f} | {ratio(by['dark'][fg], by['dark'][bg]):.2f} |")
    print("\n| step | light fill | ink | ink ratio | vs card | vs pill | step | dark fill | ink | ink ratio | vs card | vs pill | step |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for i, m in enumerate(RAMP):
        cells = []
        for th in ("light", "dark"):
            t = by[th]
            step = f"{ratio(t[RAMP[i - 1]], t[m]):.2f}" if i else "-"
            cells.append(f"`{t[m]}` | `{t[m + '-ink']}` | {ratio(t[m + '-ink'], t[m]):.2f} | {ratio(t[m], t['surface']):.2f} | {ratio(t[m], t['sunk']):.2f} | {step}")
        print(f"| {i + 1} | " + " | ".join(cells) + " |")
    print("\n| family | light hue | letters | ratio | dark hue | letters | ratio |\n|---|---|---|---|---|---|---|")
    for fid, title, light, dark in families():
        li, di = best_ink(light), best_ink(dark)
        print(f"| {title} ({title[:2]}) | `{light}` | `{li}` | {ratio(li, light):.2f} | `{dark}` | `{di}` | {ratio(di, dark):.2f} |")


if __name__ == "__main__":
    if "--table" in sys.argv:
        table()
    else:
        unittest.main()
