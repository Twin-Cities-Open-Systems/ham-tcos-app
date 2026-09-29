#!/usr/bin/env python3
"""pool_expiry.py -- fail before an NCVEC question pool stops being valid.

Each pool is valid for a fixed window (data/ham-study.json: valid_from,
valid_to). An exam session that starts after valid_to must use the next pool,
so the site needs the successor pool in the tree well before then. This exits
1 when any pool ends within --days (default 90) of today, or already ended.

USAGE
  pool_expiry.py                        check against today's date
  pool_expiry.py --today 2027-04-15     check against another date (tests)
  pool_expiry.py --days 120             widen the warning window

EXIT  0 every pool is valid for more than --days days   1 a pool is expiring or expired
      2 the data file cannot be read
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "ham-study.json"


def expiring(pools, today, days):
    """Return (pool, valid_to, days_left) for every pool ending within days of today."""
    out = []
    for p in pools:
        end = datetime.date.fromisoformat(p["valid_to"])
        left = (end - today).days
        if left <= days:
            out.append((p["pool"], end, left))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--today", type=datetime.date.fromisoformat, default=None, help="YYYY-MM-DD, default: today (UTC)")
    ap.add_argument("--days", type=int, default=90, help="fail when a pool ends within this many days (default 90)")
    ap.add_argument("--data", type=Path, default=DATA, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    today = args.today or datetime.datetime.now(datetime.timezone.utc).date()
    try:
        pools = json.loads(args.data.read_text(encoding="utf-8"))["pools"]
        bad = expiring(pools, today, args.days)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"CRITICAL cannot read pool dates from {args.data}: {exc}", file=sys.stderr)
        return 2
    for p in pools:
        end = datetime.date.fromisoformat(p["valid_to"])
        print(f"{p['pool']}: valid through {end.isoformat()} ({(end - today).days} days from {today.isoformat()})")
    if bad:
        for pool, end, left in bad:
            state = f"ended {-left} days ago" if left < 0 else f"ends in {left} days"
            print(f"CRITICAL {pool} {state} ({end.isoformat()}); add the successor pool from NCVEC "
                  f"and rebuild (window: {args.days} days)", file=sys.stderr)
        return 1
    print(f"OK no pool ends within {args.days} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
