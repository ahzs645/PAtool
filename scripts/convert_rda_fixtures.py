from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


WEB_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_ROOT.parent
PYDEPS = REPO_ROOT / ".tmp" / "pydeps"
if PYDEPS.exists():
    sys.path.insert(0, str(PYDEPS))

try:
    import pyreadr  # type: ignore
    import rdata  # type: ignore
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "Missing fixture conversion dependencies. Install local readers first, for example:\n"
        "python3.13 -m pip install --target ../.tmp/pydeps pyreadr rdata numpy pandas\n"
        f"Original error: {exc}"
    )


OUT_DIR = WEB_ROOT / "shared" / "src" / "generated"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]

    try:
        import numpy as np  # type: ignore
        import pandas as pd  # type: ignore
    except Exception:  # pragma: no cover
        np = None
        pd = None

    if value is None:
        return None
    if np is not None and isinstance(value, np.generic):
        return clean(value.item())
    if pd is not None and hasattr(pd, "isna"):
        try:
            if pd.isna(value):
                return None
        except Exception:
            pass
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def epoch_to_iso(value: Any) -> str:
    numeric = float(value)
    if numeric > 10_000_000_000:
        numeric = numeric / 1000.0
    return datetime.fromtimestamp(numeric, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(name: str, payload: Any) -> None:
    path = OUT_DIR / name
    path.write_text(json.dumps(clean(payload), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {path.relative_to(WEB_ROOT)}")


def load_pyreadr_dataframe(path: Path, key: str):
    result = pyreadr.read_r(str(path))
    return result[key]


def dataframe_records(df) -> list[dict[str, Any]]:
    return json.loads(df.to_json(orient="records", date_format="iso"))


def convert_pas() -> None:
    df = load_pyreadr_dataframe(REPO_ROOT / "data" / "example_pas.rda", "example_pas")
    raw_records = dataframe_records(df)
    write_json("example_pas.raw.json", raw_records)

    records = []
    for row in raw_records:
        location_type = row.get("DEVICE_LOCATIONTYPE")
        if location_type not in {"inside", "outside"}:
            location_type = "unknown"
        records.append(
            {
                "id": str(row["ID"]),
                "label": row["label"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "stateCode": row.get("stateCode"),
                "countryCode": row.get("countryCode"),
                "timezone": row.get("timezone"),
                "locationType": location_type,
                "uniqueId": row.get("deviceDeploymentID"),
                "pm25Current": row.get("pm25_current"),
                "pm25_10min": row.get("pm25_10min"),
                "pm25_30min": row.get("pm25_30min"),
                "pm25_1hr": row.get("pm25_1hr"),
                "pm25_6hr": row.get("pm25_6hr"),
                "pm25_1day": row.get("pm25_1day"),
                "pm25_1week": row.get("pm25_1week"),
                "humidity": row.get("humidity"),
                "pressure": row.get("pressure"),
                "temperature": row.get("temperature"),
                "distanceToClosestMonitorKm": row.get("pwfsl_closestDistance"),
            }
        )

    collection = {
        "generatedAt": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "fixture",
        "records": records,
    }
    write_json("example_pas.collection.json", collection)

    raw_df = load_pyreadr_dataframe(REPO_ROOT / "data" / "example_pas_raw.rda", "example_pas_raw")
    write_json("example_pas_raw.raw.json", dataframe_records(raw_df))


def load_rdata_object(filename: str, key: str) -> Any:
    parsed = rdata.read_rda(str(REPO_ROOT / "data" / filename))
    return parsed[key]


def convert_pat(filename: str, key: str, out_name: str) -> None:
    obj = load_rdata_object(filename, key)
    meta_df = obj["meta"]
    data_df = obj["data"]
    meta_row = json.loads(meta_df.to_json(orient="records"))[0]
    data_rows = json.loads(data_df.to_json(orient="records"))

    payload = {
        "meta": {
            "sensorId": str(meta_row["ID"]),
            "label": meta_row["label"],
            "timezone": meta_row["timezone"],
            "latitude": meta_row.get("latitude"),
            "longitude": meta_row.get("longitude"),
        },
        "points": [
            {
                "timestamp": epoch_to_iso(row["datetime"]),
                "pm25A": row.get("pm25_A"),
                "pm25B": row.get("pm25_B"),
                "humidity": row.get("humidity"),
                "temperature": row.get("temperature"),
                "pressure": None,
            }
            for row in data_rows
        ],
    }

    write_json(out_name, payload)


def convert_sensor() -> None:
    obj = load_rdata_object("example_sensor.rda", "example_sensor")
    meta_df = obj["meta"]
    data_df = obj["data"]
    meta_row = json.loads(meta_df.to_json(orient="records"))[0]
    data_rows = json.loads(data_df.to_json(orient="records"))
    measurement_keys = [key for key in data_rows[0].keys() if key != "datetime"]
    series_key = measurement_keys[0]

    payload = {
        "id": str(meta_row["ID"]),
        "meta": {
            "sensorId": str(meta_row["ID"]),
            "label": meta_row["label"],
            "timezone": meta_row["timezone"],
            "latitude": meta_row.get("latitude"),
            "longitude": meta_row.get("longitude"),
        },
        "seriesKey": series_key,
        "points": [
            {
                "timestamp": epoch_to_iso(row["datetime"]),
                "value": row.get(series_key),
            }
            for row in data_rows
        ],
    }
    write_json("example_sensor.raw.json", payload)


def main() -> None:
    convert_pas()
    convert_pat("example_pat.rda", "example_pat", "example_pat.series.json")
    convert_pat("example_pat_failure_A.rda", "example_pat_failure_A", "example_pat_failure_A.series.json")
    convert_pat("example_pat_failure_B.rda", "example_pat_failure_B", "example_pat_failure_B.series.json")
    convert_sensor()


if __name__ == "__main__":
    main()
