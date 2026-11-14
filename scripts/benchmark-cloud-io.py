#!/usr/bin/env python3
"""Measure bounded range transport, optionally reproducing a retained radar crop.

The default trace is synthetic and offline. Live mode requires explicit paths,
uses the normal allowlisted/authenticated processor, and creates a NEW output
directory. Run each case in a fresh process; never point at a job result path.
No URLs, byte offsets, response headers or credentials enter the report.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import platform
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
START = time.perf_counter()
CPU_START = time.process_time()


class MeteredResponse:
    def __init__(self, response, meter):
        self.response, self.meter = response, meter

    def __getattr__(self, name):
        return getattr(self.response, name)

    def __enter__(self):
        self.response.__enter__()
        return self

    def __exit__(self, *args):
        return self.response.__exit__(*args)

    def read(self, size):
        try:
            data = self.response.read(size)
        except http.client.IncompleteRead as exc:
            self.meter.body_bytes += len(exc.partial)
            raise
        self.meter.body_bytes += len(data)
        return data


class MeteredOpener:
    """Counts opener invocations, NOT redirect/auth HTTP round trips or headers."""
    def __init__(self, opener):
        self.opener, self.attempts, self.body_bytes = opener, 0, 0

    def open(self, req, timeout=30):
        self.attempts += 1
        return MeteredResponse(self.opener.open(req, timeout=timeout), self)


def reader_module(path):
    if path is None:
        from service import range_reader
        return range_reader
    spec = importlib.util.spec_from_file_location("benchmark_range_reader", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def trace(reader):
    class Response(io.BytesIO):
        status = 206

        def __init__(self, data, start, end):
            super().__init__(data[start:end + 1])
            self.headers = {"Content-Range": f"bytes {start}-{end}/{len(data)}",
                            "Content-Length": str(end - start + 1), "ETag": '"synthetic-v1"'}

        def geturl(self):
            return "https://nisar.asf.earthdatacloud.nasa.gov/synthetic.h5"

    data = bytes(range(256)) * 4096

    class Opener:
        def open(self, req, timeout=30):
            start, end = map(int, req.get_header("Range").removeprefix("bytes=").split("-"))
            return Response(data, start, min(end, len(data) - 1))

    opener = MeteredOpener(Opener())
    budget = reader.TransferBudget()
    asset = reader.RemoteAsset("https://nisar.asf.earthdatacloud.nasa.gov/synthetic.h5", opener, budget)
    # A large header/chunk read followed by nested metadata reads and exact hits.
    # This is an explicit exercise of reuse, not a modeled NASA workload.
    intervals = [(0, 65535)] + [(i * 256, i * 256 + 127) for i in range(128)]
    intervals += intervals[1:] + [(65536, 131071), (70000, 71023)]
    digest = hashlib.sha256()
    for start, end in intervals:
        returned = asset.fetch(start, end)
        if returned != data[start:end + 1]:
            raise RuntimeError("RANGE_PARITY")
        digest.update(returned)
    if budget.transferred != opener.body_bytes:
        raise RuntimeError("BUDGET_PARITY")
    result = {"kind": "synthetic-range-reuse", "logicalReads": len(intervals),
              "returnedSha256": digest.hexdigest(), "openerAttempts": opener.attempts,
              "bodyBytes": opener.body_bytes, "transferBudgetBytes": budget.transferred}
    if hasattr(asset, "telemetry_snapshot"):
        result["rangeDiagnostics"] = asset.telemetry_snapshot()
    return result


def radar(reader, args):
    from service import processing
    pinned = json.loads(args.manifest.read_text())
    if pinned.get("kind") != "radar-change":
        raise ValueError("RADAR_MANIFEST_REQUIRED")
    # Explicit opt-in only. No job database or existing result is modified.
    args.output_dir.mkdir(parents=True, exist_ok=False)
    metered = []
    original_opener = processing.authenticated_opener

    def opener(path):
        value = MeteredOpener(original_opener(path))
        metered.append(value)
        return value

    for name in ("RemoteAsset", "RangeFile", "RangeProxy", "RangeError", "TransferBudget"):
        setattr(processing, name, getattr(reader, name))
    processing.authenticated_opener = opener
    phases = []

    def progress(name):
        phases.append((name, time.perf_counter()))
        print(json.dumps({"phase": name, "elapsedSeconds": phases[-1][1] - START}), file=sys.stderr, flush=True)

    result = processing.process_job({"beforeId": pinned["before"]["id"],
        "afterId": pinned["after"]["id"], "bbox": pinned["crop"]["bbox"]},
        args.output_dir, args.netrc, progress)
    checks = {
        "sourceIds": all(result[k]["id"] == pinned[k]["id"] for k in ("before", "after")),
        "crop": result["crop"] == pinned["crop"],
        "statistics": result["stats"] == pinned["stats"],
        "coverage": result["coverage"] == pinned["coverage"],
        "algorithm": result["processing"]["algorithmVersion"] == pinned["processing"]["algorithmVersion"],
        "extractedInputs": all(result["processing"][k] == pinned["processing"][k]
                               for k in ("beforeSha256", "afterSha256")),
        "artifactBytes": result["processing"]["sourceMetadata"]["artifactSha256"] ==
                         pinned["processing"]["sourceMetadata"]["artifactSha256"],
    }
    received = sum(m.body_bytes for m in metered)
    charged = result["processing"]["sourceMetadata"]["transferBytes"]
    if received != charged:
        raise RuntimeError("TRANSFER_ACCOUNTING")
    diagnostics = result["processing"]["sourceMetadata"].get("rangeIo")
    if diagnostics is not None and sum(a["body_bytes_charged"] for a in diagnostics["assets"]) != charged:
        raise RuntimeError("TELEMETRY_ACCOUNTING")
    return {"kind": "live-retained-radar-crop", "parity": checks,
            "scientificParity": all(checks.values()), "statistics": result["stats"],
            "coverage": result["coverage"],
            "openerAttempts": sum(m.attempts for m in metered),
            "bodyBytes": received, "transferBudgetBytes": charged,
            "phaseSeconds": {name: end - start for (name, start), (_, end) in zip(phases, phases[1:])},
            "rangeDiagnostics": diagnostics,
            "artifactSha256": result["processing"]["sourceMetadata"]["artifactSha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reader-file", type=Path, help="Retained baseline range_reader.py (trusted code)")
    parser.add_argument("--manifest", type=Path, help="Explicit live reproduction of this retained local radar manifest")
    parser.add_argument("--netrc", type=Path)
    parser.add_argument("--output-dir", type=Path, help="New, operator-owned scratch directory")
    args = parser.parse_args()
    if args.manifest and args.reader_file:
        parser.error("Live baselines require a frozen whole-code checkout; --reader-file is for offline traces")
    if args.manifest and (args.netrc is None or args.output_dir is None):
        parser.error("Live reproduction requires --netrc and --output-dir")
    if not args.manifest and (args.netrc or args.output_dir):
        parser.error("--netrc/--output-dir are only used with --manifest")
    reader = reader_module(args.reader_file)
    try:
        result = radar(reader, args) if args.manifest else trace(reader)
    except Exception as exc:
        # No traceback/raw network exception: upstream values may contain secrets.
        print(json.dumps({"status": "failed", "code": getattr(exc, "code", "BENCHMARK_FAILED")}))
        return 1
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result.update(schemaVersion="1.0", python=platform.python_version(),
                  wallSeconds=time.perf_counter() - START, cpuSeconds=time.process_time() - CPU_START,
                  peakRssBytes=peak if sys.platform == "darwin" else peak * 1024,
                  readerSha256=hashlib.sha256(Path(reader.__file__).read_bytes()).hexdigest(),
                  limitations=["Fresh-process RSS includes imports; excludes other services and cgroup memory.",
                    "Opener attempts exclude authentication/redirect round trips, headers and TLS overhead.",
                    "No assertion of upstream cold cache, universal latency or field accuracy.",
                    "Synthetic trace demonstrates reuse only; live crop measures one retained study."])
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0 if result.get("scientificParity", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
