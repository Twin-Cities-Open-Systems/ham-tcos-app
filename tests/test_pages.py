import re
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("index.html", "study.html")
NEED = ("og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height", "og:image:alt", "og:locale")


def jpeg_size(path):
    data = path.read_bytes()
    i = 2
    while i < len(data):
        marker = data[i + 1]
        (length,) = struct.unpack(">H", data[i + 2:i + 4])
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    raise ValueError("no SOF marker")


class OpenGraph(unittest.TestCase):
    def test_every_page_carries_the_og_set_and_a_real_image(self):
        for page in PAGES:
            html = (ROOT / page).read_text()
            for prop in NEED:
                self.assertIn(f'property="{prop}"', html, f"{page} lacks {prop}")
            self.assertIn('name="twitter:card" content="summary_large_image"', html, page)
            self.assertIn('name="twitter:image"', html, page)
            image = re.search(r'property="og:image" content="([^"]+)"', html).group(1)
            self.assertTrue(image.startswith("https://ham.tcos.app/"), f"{page}: og:image must be absolute")
            self.assertEqual(jpeg_size(ROOT / image.rsplit("/", 1)[1]), (1200, 630))

    def test_title_is_the_product_name(self):
        for page in PAGES:
            self.assertIn("Just Another Ham Study", (ROOT / page).read_text(), page)


if __name__ == "__main__":
    unittest.main()
