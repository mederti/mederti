"""
Build the MapView hospitals layer: Overture Maps places -> PMTiles.

Extracts hospital POIs from the Overture Maps places theme (CDLA-Permissive
licensed — safe to ingest/redistribute, unlike raw OSM's ODbL) with DuckDB,
then bakes them into a single static PMTiles vector-tile file that MapLibre
streams by viewport. No database rows, no scraper, no cron — regenerate
quarterly (Overture releases monthly) by re-running this script.

Prereqs
───────
    pip3 install duckdb
    brew install tippecanoe

Usage
─────
    # Global (default; scans a few GB of remote parquet — takes a while)
    python3 backend/scripts/build_healthcare_tiles.py

    # Regional spot-check first (bbox = min_lon,min_lat,max_lon,max_lat)
    python3 backend/scripts/build_healthcare_tiles.py --bbox 5.9,45.8,10.5,47.8

    # Pharmacies later reuse the same pipeline:
    python3 backend/scripts/build_healthcare_tiles.py --category pharmacy

Output
──────
    frontend/public/tiles/<category>s.pmtiles   (gitignored — deploy to
    Supabase Storage / object storage for prod; see MapView memory notes)
"""

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "frontend" / "public" / "tiles"

# Pin a known Overture release; bump deliberately when regenerating.
# The bucket only retains recent releases — list current ones with:
#   curl -s "https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
OVERTURE_RELEASE = "2026-06-17.0"
OVERTURE_S3 = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=places/type=place/*"


def extract(category: str, bbox: Optional[str], ndjson_path: Path) -> int:
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")

    bbox_clause = ""
    if bbox:
        min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
        # bbox columns are parquet row-group stats — this prunes remote reads.
        bbox_clause = f"""
          AND bbox.xmin >= {min_lon} AND bbox.xmax <= {max_lon}
          AND bbox.ymin >= {min_lat} AND bbox.ymax <= {max_lat}
        """

    query = f"""
      COPY (
        SELECT
          names.primary AS name,
          categories.primary AS category,
          ST_AsGeoJSON(geometry)::JSON AS geometry
        FROM read_parquet('{OVERTURE_S3}', hive_partitioning=1)
        WHERE categories.primary = '{category}'
          AND names.primary IS NOT NULL
          {bbox_clause}
      ) TO '{ndjson_path}' (FORMAT JSON);
    """
    con.execute(query)

    count = sum(1 for _ in open(ndjson_path))
    return count


def to_geojson_features(ndjson_path: Path, features_path: Path) -> None:
    """DuckDB JSON rows -> newline-delimited GeoJSON Features for tippecanoe."""
    import json

    with open(ndjson_path) as src, open(features_path, "w") as dst:
        for line in src:
            row = json.loads(line)
            dst.write(
                json.dumps(
                    {
                        "type": "Feature",
                        "geometry": row["geometry"],
                        "properties": {"name": row["name"], "category": row["category"]},
                    }
                )
                + "\n"
            )


def build_tiles(features_path: Path, out_path: Path, layer: str) -> None:
    subprocess.run(
        [
            "tippecanoe",
            "-o", str(out_path),
            "--force",
            "-l", layer,
            "-zg",                        # let tippecanoe pick max zoom
            "--drop-densest-as-needed",   # thin dense clusters at low zoom
            "--extend-zooms-if-still-dropping",
            str(features_path),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", default="hospital", help="Overture category (hospital, pharmacy)")
    parser.add_argument("--bbox", default=None, help="min_lon,min_lat,max_lon,max_lat — omit for global")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    layer = f"{args.category}s"
    ndjson_path = OUT_DIR / f"{layer}.rows.json"
    features_path = OUT_DIR / f"{layer}.features.json"
    out_path = OUT_DIR / f"{layer}.pmtiles"

    scope = f"bbox {args.bbox}" if args.bbox else "GLOBAL"
    print(f"[tiles] extracting Overture {OVERTURE_RELEASE} places, category={args.category}, scope={scope}")
    count = extract(args.category, args.bbox, ndjson_path)
    print(f"[tiles] extracted {count} features")
    if count == 0:
        print("[tiles] nothing extracted — aborting before tippecanoe", file=sys.stderr)
        sys.exit(1)

    to_geojson_features(ndjson_path, features_path)
    build_tiles(features_path, out_path, layer)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"[tiles] wrote {out_path} ({size_mb:.1f} MB)")

    ndjson_path.unlink(missing_ok=True)
    features_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
