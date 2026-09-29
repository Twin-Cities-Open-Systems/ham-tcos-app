import contextlib
import datetime
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import pool_expiry


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = pool_expiry.main(list(argv))
    return rc, out.getvalue(), err.getvalue()


class Expiry(unittest.TestCase):
    def data(self, *ends):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        path = Path(d.name) / "study.json"
        path.write_text(json.dumps({"pools": [{"pool": f"p{i}", "valid_to": e} for i, e in enumerate(ends)]}))
        return str(path)

    def test_the_committed_pools_are_reported_with_their_end_dates(self):
        rc, out, _ = run("--today", "2026-09-29")
        self.assertEqual(rc, 0, out)
        for end in ("2030-06-30", "2027-06-30", "2028-06-30"):
            self.assertIn(f"valid through {end}", out)

    def test_ninety_days_out_fails_and_ninety_one_passes(self):
        end = datetime.date(2027, 6, 30)
        edge = (end - datetime.timedelta(days=90)).isoformat()
        before = (end - datetime.timedelta(days=91)).isoformat()
        self.assertEqual(run("--today", edge)[0], 1)
        self.assertEqual(run("--today", before)[0], 0)

    def test_the_failure_names_the_pool_and_the_days_left(self):
        rc, _, err = run("--today", "2027-05-01", "--data", self.data("2027-06-30", "2030-06-30"))
        self.assertEqual(rc, 1)
        self.assertIn("p0 ends in 60 days", err)
        self.assertNotIn("p1", err)

    def test_an_expired_pool_fails(self):
        rc, _, err = run("--today", "2027-07-02", "--data", self.data("2027-06-30"))
        self.assertEqual(rc, 1)
        self.assertIn("ended 2 days ago", err)

    def test_days_widens_the_window(self):
        data = self.data("2027-06-30")
        self.assertEqual(run("--today", "2027-01-01", "--data", data)[0], 0)
        self.assertEqual(run("--today", "2027-01-01", "--days", "365", "--data", data)[0], 1)

    def test_unreadable_data_is_critical_not_a_pass(self):
        rc, _, err = run("--today", "2026-09-29", "--data", "/nonexistent/study.json")
        self.assertEqual(rc, 2)
        self.assertIn("CRITICAL", err)


if __name__ == "__main__":
    unittest.main()
