"""Pure, private descriptive comparison of two frozen optical image reviews.

No adjudication, field truth, reviewer independence or accuracy is established.
The input validators retain their native GDAL/OSR CRS checks. This module has no
file IO, acquisition, classifier, CLI or review-correction path.
"""
from copy import deepcopy
import hashlib
import json
import math
import unicodedata

from .reference_review import validate_review

SCHEMA_VERSION = 1
METHOD_VERSION = "optical-review-comparison-v1"
COMPARISON_KIND = "optical-image-review-comparison"
MAX_COMBINED_INPUT_BYTES = 3 * 1024 * 1024
MAX_ARTIFACT_BYTES = 4 * 1024 * 1024
PRIMARY_STATUSES = ("pending", "not_observable", "uncertain", "different_labels", "same_label")
DECISION_STATES = ("unreviewed", "reviewed_unobservable", "reviewed_unknown_visibility",
                   "reviewed_observable_unknown", "reviewed_water", "reviewed_non_water")
ALIAS_NORMALIZATION = "NFC, then ASCII A-Z lowercase only"
LIMITATIONS = (
    "Aliases are not identities; distinct normalized aliases do not establish reviewer independence.",
    "Alias normalization is NFC then ASCII A-Z lowercase only, not full Unicode caseless equivalence.",
    "Subjective interpretation of shared development images is not independent field truth.",
    "Stratified sample counts cannot be projected to regional rates or population areas.",
    "Status precedence describes missingness in this artifact, not a universal scientific rule.",
    "Unresolved labels stay unknown; matching unknown labels are never known-label agreement.",
    "Hashes establish integrity, not authentication or reviewer authorship.",
    "This private artifact contains reviewer aliases, reasons and times; sharing requires deliberate care.",
)


def _canonical_bounded(value, limit):
    """Strict sorted compact UTF-8 JSON, bounded before validation's big copies.

    Unlike reference_review._canonical, this budget applies to the serialized
    combined inputs/output, not a 1MiB aggregate-text budget. The two existing
    validators still enforce their own per-review limits. Incremental encoding
    enforces the byte ceiling including punctuation/escaping. The prewalk bounds
    strings, nodes, depth and integers, and rejects cycles/non-JSON Python types.
    """
    nodes = 0
    text_bytes = 0

    def visit(item, depth):
        nonlocal nodes, text_bytes
        nodes += 1
        if depth > 16 or nodes > 100_000:
            raise ValueError("JSON structure too large/deep")
        if type(item) is str:
            if len(item) > limit:
                raise ValueError("serialized JSON byte limit exceeded")
            try:
                text_bytes += len(item.encode("utf-8"))
            except UnicodeError as exc:
                raise ValueError("invalid Unicode text") from exc
            if text_bytes > limit:
                raise ValueError("serialized JSON byte limit exceeded")
        elif type(item) is dict:
            for key, val in item.items():
                if type(key) is not str:
                    raise ValueError("JSON keys must be strings")
                visit(key, depth + 1)
                visit(val, depth + 1)
        elif type(item) is list:
            for val in item:
                visit(val, depth + 1)
        elif type(item) is float:
            if not math.isfinite(item):
                raise ValueError("nonfinite JSON number")
        elif type(item) is int:
            if item.bit_length() > 4096:
                raise ValueError("JSON integer too large")
        elif item is not None and type(item) is not bool:
            raise ValueError("unsupported JSON type")

    visit(value, 0)
    encoded = bytearray()
    encoder = json.JSONEncoder(sort_keys=True, separators=(",", ":"),
                               ensure_ascii=False, allow_nan=False)
    for piece in encoder.iterencode(value):
        chunk = piece.encode("utf-8")
        if len(encoded) + len(chunk) > limit:
            raise ValueError("serialized JSON byte limit exceeded")
        encoded.extend(chunk)
    return bytes(encoded)


def _normalized_alias(alias):
    # Do not use lower()/casefold(): non-ASCII case behavior is intentionally
    # outside this convention. Normalization does not authenticate identity.
    return unicodedata.normalize("NFC", alias).translate(
        str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))


def _primary_status(left, right):
    if left["status"] == "unreviewed" or right["status"] == "unreviewed":
        return "pending"
    if left["visibility"] == "unobservable" or right["visibility"] == "unobservable":
        return "not_observable"
    if (left["visibility"] == "unknown" or right["visibility"] == "unknown"
            or left["label"] == "unknown" or right["label"] == "unknown"):
        return "uncertain"
    return "same_label" if left["label"] == right["label"] else "different_labels"


def _decision_state(decision):
    if decision["status"] == "unreviewed":
        return "unreviewed"
    if decision["visibility"] == "unobservable":
        return "reviewed_unobservable"
    if decision["visibility"] == "unknown":
        return "reviewed_unknown_visibility"
    if decision["label"] == "unknown":
        return "reviewed_observable_unknown"
    return "reviewed_" + decision["label"]


def compare_reviews(packet, left, right):
    """Return a detached JSON-safe descriptive artifact, never resolved labels.

    Rows follow packet sample order, then before/after source order. Metadata
    preserves supplied A/B order. Primary counts are symmetric; swapping reviews
    swaps raw row decisions and transposes the all-slot joint decision table.
    Distinct normalized aliases and review hashes are necessary bookkeeping
    checks only, and cannot prove that two independent people supplied reviews.
    """
    # Do this before validate_review returns any detached packet/review copies.
    _canonical_bounded({"packet": packet, "left": left, "right": right},
                       MAX_COMBINED_INPUT_BYTES)
    a = validate_review(packet, left)
    b = validate_review(packet, right)
    if a["reviewHash"] == b["reviewHash"]:
        raise ValueError("canonical review hashes must differ")
    if _normalized_alias(a["review"]["reviewerAlias"]) == _normalized_alias(b["review"]["reviewerAlias"]):
        raise ValueError("normalized reviewer aliases must differ")

    by_left = {entry["sampleId"]: entry for entry in a["review"]["reviews"]}
    by_right = {entry["sampleId"]: entry for entry in b["review"]["reviews"]}
    counts = {status: 0 for status in PRIMARY_STATUSES}
    endpoints = {side: {status: 0 for status in PRIMARY_STATUSES} for side in ("before", "after")}
    joint = [[0 for _ in DECISION_STATES] for _ in DECISION_STATES]
    flags = 0
    rows = []
    for sample in packet["samples"]:
        for side, source in zip(("before", "after"), packet["sources"]):
            ld = by_left[sample["id"]][side]
            rd = by_right[sample["id"]][side]
            status = _primary_status(ld, rd)
            known_visibility_disagreement = (
                ld["status"] == rd["status"] == "reviewed"
                and ld["visibility"] in ("observable", "unobservable")
                and rd["visibility"] in ("observable", "unobservable")
                and ld["visibility"] != rd["visibility"])
            counts[status] += 1
            endpoints[side][status] += 1
            joint[DECISION_STATES.index(_decision_state(ld))][DECISION_STATES.index(_decision_state(rd))] += 1
            flags += int(known_visibility_disagreement)
            rows.append({"sampleId": sample["id"], "row": sample["row"], "col": sample["col"],
                         "side": side, "sourceId": source["id"], "observedAt": source["observedAt"],
                         "left": deepcopy(ld), "right": deepcopy(rd), "status": status,
                         "knownVisibilityDisagreement": known_visibility_disagreement})

    expected = 2 * len(packet["samples"])
    artifact = {
        "schemaVersion": SCHEMA_VERSION, "methodVersion": METHOD_VERSION, "kind": COMPARISON_KIND,
        "developmentOnly": True, "private": True,
        "status": "no-selected-cells" if expected == 0 else "compared",
        "packetHash": packet["packetHash"], "grid": deepcopy(packet["grid"]),
        "sources": deepcopy(packet["sources"]), "source_pins": deepcopy(packet["source_pins"]),
        "inputs": {"left": {"position": "A", "reviewHash": a["reviewHash"],
                            "reviewerAlias": a["review"]["reviewerAlias"]},
                   "right": {"position": "B", "reviewHash": b["reviewHash"],
                             "reviewerAlias": b["review"]["reviewerAlias"]}},
        "aliasNormalization": ALIAS_NORMALIZATION,
        "counts": {"expectedEndpointSlots": expected, "allSlots": len(rows),
                   "comparableKnownSlots": counts["different_labels"] + counts["same_label"],
                   "primary": counts},
        "endpointCounts": endpoints,
        "denominators": {"allSlots": "Every selected sample/date pair, including missing or uncertain decisions.",
                         "comparableKnownSlots": "Only different_labels plus same_label; both labels known and observable."},
        "primaryStatusPrecedence": list(PRIMARY_STATUSES),
        "flagCounts": {"knownVisibilityDisagreement": flags},
        "flagCountSemantics": "Overlapping flags independent of the primary partition; never add them to a denominator.",
        "jointCounts": {"stateOrder": list(DECISION_STATES), "leftByRight": joint,
                        "denominator": "allSlots"},
        "rows": rows,
        "independenceEstablished": False, "fieldTruthEstablished": False,
        "accuracyEstimated": False, "areaAdjusted": False, "adjudicationPerformed": False,
        "limitations": list(LIMITATIONS),
        "limits": {"maxSamples": 320, "maxCombinedInputBytes": MAX_COMBINED_INPUT_BYTES,
                   "maxArtifactBytes": MAX_ARTIFACT_BYTES},
    }
    artifact["comparisonHash"] = hashlib.sha256(
        _canonical_bounded(artifact, MAX_ARTIFACT_BYTES)).hexdigest()
    _canonical_bounded(artifact, MAX_ARTIFACT_BYTES)  # Includes the self-hash field in the output bound.
    return artifact
