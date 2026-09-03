#!/usr/bin/env python3
"""
Dump the introspected schema to a JSON snapshot.

Run inside the built Docker image (Athena + TopCPToolkit available)::

    docker run --rm tct-gui bash -c \\
      "source /home/atlas/release_setup.sh && \\
       source /opt/TopCPToolkit/build/*/setup.sh && \\
       python3 /app/backend/scripts/dump_schema.py /app/schema.snapshot.json"
    docker cp <container>:/app/schema.snapshot.json frontend/src/schema.snapshot.json

The snapshot is what the backend serves when Athena is not importable (local
frontend development, CI), and what the frontend tests run against.  Commit
it whenever the target AB / TCT release changes.
"""

import json
import os
import sys

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND)

from app import REPO_ROOT, build_full_schema  # noqa: E402

DEFAULT_OUT = os.path.join(REPO_ROOT, "frontend", "src", "schema.snapshot.json")


def main(argv):
    out = argv[1] if len(argv) > 1 else DEFAULT_OUT
    schema = build_full_schema(include_example_content=True)
    if schema["source"] != "athena":
        sys.exit("Athena is not importable here — run this inside the Docker image "
                 "after sourcing release_setup.sh (and the TCT setup.sh).")

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    errors = [b["factoryName"] for b in schema["blocks"] if b.get("error")]
    errors += [f"{b['factoryName']}.{s['name']}" for b in schema["blocks"]
               for s in b["subBlocks"] if s.get("error")]
    errors += [e["algName"] for e in schema["catalogue"] if e.get("block", {}).get("error")]
    print(f"Wrote {out}")
    print(f"  {len(schema['blocks'])} root blocks, "
          f"{sum(len(b['subBlocks']) for b in schema['blocks'])} sub-block slots, "
          f"{len(schema['catalogue'])} catalogue entries, "
          f"{len(schema['examples'])} example configs")
    print(f"  versions: {schema['versions']}")
    if errors:
        print(f"  WARNING: {len(errors)} block(s) failed introspection: {', '.join(errors)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
