"""Small, visibly synthetic fixtures for software verification, never NISAR labels."""

import hashlib
import json
from pathlib import Path

import numpy as np

from .evaluator import (AGGREGATION, ARRAYS, CLASS_DEFINITION, SUPPORT_POLICY,
                        array_sha256, file_sha256)


def write_fixture(directory):
    """Create a new fixture directory. Refuse overwrite of any existing path."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    shape = (2, 5)
    values = {
        "reference_before": [0, 0, 1, 1, 0, 0, 1, -1, 0, 1],
        "reference_after": [0, 1, 0, 1, 1, 0, 1, 1, 0, 0],
        "prediction_before": [0, 0, 0, 1, -1, 0, 1, 0, 1, 1],
        "prediction_after": [0, 1, 1, 1, -1, 1, 1, 1, 0, 0],
        "common_observable": [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        "reference_observable": [1, 1, 1, 1, 1, 1, 0, 1, 1, 0],
    }
    arrays = {k: np.asarray(values[k], dtype=np.int8).reshape(shape) for k in ARRAYS}
    archive = directory / "synthetic.npz"
    np.savez_compressed(archive, **arrays)
    hashes = {k: array_sha256(v) for k, v in arrays.items()}
    geometry = "POLYGON ((0 0, 10 0, 10 4, 0 4, 0 0))"
    times = ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]
    case = {
        "id": "SYNTHETIC-software-check", "fold": "final", "event_id": "SYNTHETIC-event",
        "site_id": "SYNTHETIC-site", "acquisition_ids": ["SYNTHETIC-before", "SYNTHETIC-after"],
        "grid": {"id": "SYNTHETIC-grid", "shape": list(shape), "crs": "SYNTHETIC-equal-area-metres",
                 "transform": [0, 2, 0, 4, 0, -2], "transform_convention": "GDAL", "pixel_area_m2": 4,
                 "linear_units": "metre", "area_method": "constant_equal_area_m2",
                 "area_evidence": "Constructed 2m by 2m software-test cells"},
        "geometry": {"id": "SYNTHETIC-geometry", "definition": geometry,
                     "sha256": hashlib.sha256(geometry.encode()).hexdigest()},
        "mask": {"id": "SYNTHETIC-mask", "definition": "Handcrafted common support; last cell outside",
                 "sha256": hashes["common_observable"]},
        "inputs": {"path": archive.name, "archive_sha256": file_sha256(archive), "array_sha256": hashes},
        "sources": [{"product_id": f"SYNTHETIC-product-{i}", "product_release": "software-check-v1",
                     "maturity": "SYNTHETIC", "crid": "SYNTHETIC-NOT-A-PRODUCT",
                     "sensor": "SYNTHETIC", "frequency_band": "NONE", "acquired_at": times[i],
                     "acquisition_id": case_id, "grid_id": "SYNTHETIC-grid", "geometry_id": "SYNTHETIC-geometry",
                     "mask_id": "SYNTHETIC-mask", "known_issues": ["No physical measurement or field truth"],
                     "sha256": hashlib.sha256(f"SYNTHETIC-source-{i}".encode()).hexdigest()}
                    for i, case_id in enumerate(("SYNTHETIC-before", "SYNTHETIC-after"))],
        "reference": {"id": "SYNTHETIC-hand-calculation", "provenance": "Constructed software-test vectors",
                      "label_method": "Handcrafted binary vectors, no downloaded/derived labels",
                      "before_time": times[0], "after_time": times[1], "frozen_at": "2026-01-03T00:00:00Z",
                      "temporal_match": "resolved", "visibility": "resolved",
                      "visibility_evidence": "Synthetic per-pixel reference_observable mask",
                      "independence": "independent", "independence_evidence": "Constructed reference vectors for arithmetic tests only",
                      "dependency_ids": ["SYNTHETIC-test-design"],
                      "licence": {"status": "resolved", "terms_id": "SYNTHETIC-created-here",
                                  "evidence": "No external data; generated solely for software checks", "evaluation_allowed": True}},
    }
    manifest = {
        "schema_version": 1, "task": "open_water_transition", "track": "synthetic",
        "evidence_kind": "synthetic_software_check",
        "policy": {"frozen_at": "2026-01-03T00:00:00Z", "class_definition": CLASS_DEFINITION,
                   "support_policy": SUPPORT_POLICY, "aggregation": AGGREGATION,
                   "algorithm": {"name": "SYNTHETIC-handcrafted-predictions", "version": "1",
                                 "parameters": {}, "dependency_ids": []},
                   "task_budget": {"false_alert_area_per_reference_valid_area_max": 0.5,
                                   "prediction_abstention_rate_reference_valid_max": 0.25,
                                   "min_inclusive_change_recall": 0.5, "minimum_final_cases": 1,
                                   "minimum_final_events": 1, "reason": "Arithmetic demonstration only; not a field release criterion"}},
        "cases": [case],
    }
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n")
    return {"manifest": str(path), "manifest_sha256": file_sha256(path),
            "warning": "SYNTHETIC SOFTWARE CHECK ONLY; not field accuracy or NISAR validation"}
