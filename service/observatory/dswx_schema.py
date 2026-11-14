"""Bounded header witness for one known DSWx-HLS collapsed WTR encoder.

This is schema admission, not header authentication or field calibration. The
caller must separately bind the original B01 URI to a trusted source publisher.
Primary reference: pinned PROTEUS v1.0.2 dswx_hls.py, interpreted color table
and collapse_wtr_classes_dict. No general processing-v1.1 compatibility implied.
"""
import hashlib
import json
import math

VERSION = 'dswx-hls-proteus-1.0.2-collapsed-wtr-v1'
REQUIRED_METADATA = {
    'PRODUCT_ID': 'dswx_hls',
    'PRODUCT_TYPE': 'DSWx-HLS',
    'PRODUCT_SOURCE': 'HLS',
    'PRODUCT_VERSION': '1.1',
    'SOFTWARE_VERSION': '1.0.2',
}
UNSUPPORTED_MESSAGE = 'DSWx-HLS source does not satisfy the supported collapsed WTR schema'
SCHEMA_POLICY = (
    'Exact product/software declarations, WTR Byte/fill header, collapsed palette '
    'and native projected 30 m grid required; selected raw values limited to '
    '0/1/2/252/253/254/255. Class 1 is mapped open water; class 2 is partial-water '
    'pixel footprint, not fractional open-water area.'
)
QUALITY_NOTE = (
    'DSWx-HLS processing 1.1 and known PROTEUS 1.0.2 collapsed WTR encoder are '
    'declared by the checked source header, not proof that this encoder executed. '
    'Exact header/palette and selected raw-domain checks admit this schema only. '
    'Class-1 mapped footprint or change is not validated ecological change or '
    'field-calibrated area; class 2 remains partial-water pixel footprint, not '
    'fractional open-water area. Header checks do not authenticate the publisher.'
)


def _finite_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_header(metadata, description, band_type_name, nodata, palette,
                    expected_processing_version, crs_is_projected, linear_units,
                    transform):
    """Return detached JSON witness with a canonical hash, or raise ValueError.

    Only allowlisted product declarations enter the receipt. Other metadata is
    bounded but never copied or hashed (it may contain private source strings).
    Palette entries 0..4 are witnessed; entries 3/4 require black RGB, while their
    alpha is recorded. Single-band count is the caller's prerequisite.
    """
    if (type(expected_processing_version) is not str
            or expected_processing_version != '1.1'):
        raise ValueError(UNSUPPORTED_MESSAGE)
    if type(metadata) is not dict or not 5 <= len(metadata) <= 256:
        raise ValueError(UNSUPPORTED_MESSAGE)
    size = 0
    for key, value in metadata.items():
        if (type(key) is not str or type(value) is not str
                or len(key) > 128 or len(value) > 4096):
            raise ValueError(UNSUPPORTED_MESSAGE)
        size += len(key) + len(value)
        if size > 65536:
            raise ValueError(UNSUPPORTED_MESSAGE)
    if any(metadata.get(k) != v for k, v in REQUIRED_METADATA.items()):
        raise ValueError(UNSUPPORTED_MESSAGE)
    if (type(description) is not str or description != 'Water classification (WTR)'
            or type(band_type_name) is not str or band_type_name != 'Byte'
            or not _finite_number(nodata) or nodata != 255
            or crs_is_projected is not True
            or not _finite_number(linear_units) or linear_units != 1):
        raise ValueError(UNSUPPORTED_MESSAGE)
    if (type(transform) not in (list, tuple) or len(transform) != 6
            or not all(_finite_number(v) for v in transform)
            or (transform[1], transform[2], transform[4], transform[5]) != (30, 0, 0, -30)):
        raise ValueError(UNSUPPORTED_MESSAGE)
    if type(palette) not in (list, tuple) or not 5 <= len(palette) <= 256:
        raise ValueError(UNSUPPORTED_MESSAGE)
    for entry in palette:
        if (type(entry) not in (list, tuple) or len(entry) != 4
                or any(type(v) is not int or not 0 <= v <= 255 for v in entry)):
            raise ValueError(UNSUPPORTED_MESSAGE)
    if (tuple(palette[0]) != (255, 255, 255, 255)
            or tuple(palette[1]) != (0, 0, 255, 255)
            or tuple(palette[2]) != (180, 213, 244, 255)
            or any(tuple(palette[i][:3]) != (0, 0, 0) for i in (3, 4))):
        raise ValueError(UNSUPPORTED_MESSAGE)
    receipt = {
        'version': VERSION,
        'sourceVersion': 'PROTEUS 1.0.2',
        'schemaPolicy': SCHEMA_POLICY,
        'checked': {
            'metadata': {k: metadata[k] for k in REQUIRED_METADATA},
            'expectedProcessingVersion': '1.1',
            'description': description,
            'bandType': band_type_name,
            'nodata': 255,
            'crsIsProjected': True,
            'linearUnits': 1,
            'transform': [float(v) if v != 0 else 0.0 for v in transform],
            'paletteCount': len(palette),
            'palette': {str(i): list(palette[i]) for i in range(5)},
        },
    }
    canonical = json.dumps(receipt, sort_keys=True, separators=(',', ':'), allow_nan=False)
    receipt['receiptHash'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return receipt
