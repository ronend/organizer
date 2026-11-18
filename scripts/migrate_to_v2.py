#!/usr/bin/env python3
"""Migrate a coo household from data model version 1 to version 2.

The mapping and validation live in backend/src/migration.py, shared with
POST /api/migrate (which signed-in users can call for their own household).
This script is for operators: a dry run over an export, or a run for one user.

Modes
-----
  --input-file v1.json          offline: a JSON list of v1 records (e.g. the
                                frontend mock's `coo.mock.state` values or
                                backend/tests/fixtures/frontend_state.json);
                                prints the report, and with --output writes
                                the v2 records.
  --user-id <sub> --table <t>   reads the user's COO# rows from DynamoDB and,
                                unless --dry-run, writes the V2# rows. The
                                v1 rows are never changed or deleted.

Examples
--------
  python3 scripts/migrate_to_v2.py --input-file backend/tests/fixtures/frontend_state.json
  python3 scripts/migrate_to_v2.py --user-id <sub> --table <name> --dry-run
  python3 scripts/migrate_to_v2.py --user-id <sub> --table <name>

Exits 1 if any migrated record fails validation (nothing is written then).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input-file", type=Path)
    ap.add_argument("--output", type=Path, help="offline mode: write the v2 records here")
    ap.add_argument("--user-id")
    ap.add_argument("--table")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.input_file:
        from pydantic import TypeAdapter, ValidationError

        from src import integrity, migration
        from src.models import Entity

        records, report = migration.migrate(migration.group_v1(json.loads(args.input_file.read_text())))
        errors = []
        ta = TypeAdapter(Entity)
        for r in records:
            try:
                ta.validate_python(r)
            except ValidationError as e:
                errors.append(f"{r['kind']} {r['id']}: {e.errors()[0]['msg']}")
        errors += integrity.check_all(migration.to_state(records))
        print(json.dumps({**report, "errors": errors}, indent=2, ensure_ascii=False))
        if args.output and not errors:
            args.output.write_text(json.dumps(records, indent=2, ensure_ascii=False))
            print(f"wrote {len(records)} records to {args.output}", file=sys.stderr)
        return 1 if errors else 0

    if not (args.user_id and args.table):
        ap.error("use --input-file, or --user-id with --table")
    os.environ["DYNAMO_TABLE"] = args.table
    from src.routes.migrate import run

    status, body = run(args.user_id, args.dry_run)
    print(json.dumps(body, indent=2, ensure_ascii=False))
    return 0 if status == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
