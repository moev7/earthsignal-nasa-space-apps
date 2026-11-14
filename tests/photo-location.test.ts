import test from "node:test";
import assert from "node:assert/strict";
import { PHOTO_HEADER_BYTES, PHOTO_MAX_BYTES, parsePhotoLocation, parsePhotoPoint } from "../lib/photo-location";

type Rational = [number, number];
type Dms = [Rational, Rational, Rational];
const LAT: Dms = [[35, 1], [41, 1], [1234, 100]];
const LON: Dms = [[51, 1], [25, 1], [2345, 100]];
const ZERO: Dms = [[0, 1], [0, 1], [0, 1]];

function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return join(Uint8Array.of(0xff, marker, length >> 8, length & 255), payload);
}

const SOI = Uint8Array.of(0xff, 0xd8);
const EOI = Uint8Array.of(0xff, 0xd9);
const SOS = segment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0));
const EXIF = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0);

/** Synthetic TIFF; all offsets remain relative to the TIFF header. */
function fixture(options: { little?: boolean; latitude?: Dms; longitude?: Dms; latRef?: string; lonRef?: string; gps?: boolean } = {}) {
  const little = options.little ?? true;
  const tiff = new Uint8Array(160);
  const view = new DataView(tiff.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, little);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, little);
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  u16(2, 42); u32(4, 8);
  u16(8, options.gps === false ? 0 : 1);
  if (options.gps !== false) {
    u16(10, 0x8825); u16(12, 4); u32(14, 1); u32(18, 26);
    u16(26, 4);
    for (let i = 0; i < 4; i++) {
      const at = 28 + i * 12;
      const ref = i === 0 || i === 2;
      u16(at, i + 1); u16(at + 2, ref ? 2 : 5); u32(at + 4, ref ? 2 : 3);
      if (ref) tiff[at + 8] = (i === 0 ? options.latRef ?? "N" : options.lonRef ?? "E").charCodeAt(0);
      else u32(at + 8, i === 1 ? 80 : 104);
    }
    for (const [offset, values] of [[80, options.latitude ?? LAT], [104, options.longitude ?? LON]] as const) {
      values.forEach(([numerator, denominator], i) => { u32(offset + i * 8, numerator); u32(offset + i * 8 + 4, denominator); });
    }
  }
  return { tiff, u16, u32, jpeg: () => join(SOI, segment(0xe1, join(EXIF, tiff)), EOI) };
}

function expectInvalid(bytes: Uint8Array) {
  const result = parsePhotoLocation(bytes);
  assert.equal(result.status, "invalid");
  assert.match(result.message, /map|manually/);
}

test("exports the bounded 20 MiB file and 256 KiB header limits", () => {
  assert.equal(PHOTO_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(PHOTO_HEADER_BYTES, 256 * 1024);
  expectInvalid(new Uint8Array(PHOTO_MAX_BYTES + 1));
});

test("little- and big-endian TIFF return only the camera-recorded point", () => {
  for (const little of [true, false]) {
    const source = fixture({ little }).jpeg();
    const before = source.slice();
    assert.deepEqual(parsePhotoLocation(source), {
      status: "located", point: { longitude: 51 + 25 / 60 + 23.45 / 3600, latitude: 35 + 41 / 60 + 12.34 / 3600 },
    });
    assert.deepEqual(source, before);
  }
});

test("honors S/W references and a Uint8Array with a nonzero buffer offset", () => {
  const jpeg = fixture({ little: false, latRef: "S", lonRef: "W" }).jpeg();
  const backing = join(new Uint8Array(37), jpeg, new Uint8Array(23));
  const result = parsePhotoLocation(backing.subarray(37, 37 + jpeg.length));
  assert.deepEqual(result, { status: "located", point: { longitude: -(51 + 25 / 60 + 23.45 / 3600), latitude: -(35 + 41 / 60 + 12.34 / 3600) } });
});

test("accepts zero in every hemisphere and canonicalizes negative zero", () => {
  for (const latRef of ["N", "S"]) for (const lonRef of ["E", "W"]) {
    assert.deepEqual(parsePhotoLocation(fixture({ latitude: ZERO, longitude: ZERO, latRef, lonRef }).jpeg()), {
      status: "located", point: { longitude: 0, latitude: 0 },
    });
  }
});

test("accepts exact 90/180 degree boundaries only with zero minutes and seconds", () => {
  for (const little of [true, false]) {
    const latitude: Dms = [[90, 1], [0, 1], [0, 1]];
    const longitude: Dms = [[180, 1], [0, 1], [0, 1]];
    assert.deepEqual(parsePhotoLocation(fixture({ little, latitude, longitude, latRef: "S", lonRef: "W" }).jpeg()), {
      status: "located", point: { longitude: -180, latitude: -90 },
    });
    expectInvalid(fixture({ little, latitude: [[90, 1], [1, 100], [0, 1]] }).jpeg());
    expectInvalid(fixture({ little, longitude: [[180, 1], [0, 1], [1, 100]] }).jpeg());
    expectInvalid(fixture({ little, latitude: [[179, 2], [30, 1], [0, 1]] }).jpeg());
    expectInvalid(fixture({ little, longitude: [[359, 2], [30, 1], [0, 1]] }).jpeg());
  }
});

test("rejects zero denominators, signed rational types, invalid DMS and out-of-range sums", () => {
  for (const little of [true, false]) {
    for (const latitude of [
      [[35, 0], [0, 1], [0, 1]], [[35, 1], [60, 1], [0, 1]], [[35, 1], [0, 1], [60, 1]],
      [[91, 1], [0, 1], [0, 1]], [[0xffffffff, 1], [0, 1], [0, 1]], [[8999, 100], [1, 1], [0, 1]],
    ] as Dms[]) expectInvalid(fixture({ little, latitude }).jpeg());
    const signed = fixture({ little }); signed.u16(42, 10); expectInvalid(signed.jpeg());
    const wrongCount = fixture({ little }); wrongCount.u32(44, 2); expectInvalid(wrongCount.jpeg());
  }
});

test("requires both axis references, uppercase correct axis and ASCII NUL terminators", () => {
  for (const latRef of ["n", "E", "W", " ", "X", "\0"]) expectInvalid(fixture({ latRef }).jpeg());
  for (const lonRef of ["e", "N", "S", " ", "X", "\0"]) expectInvalid(fixture({ lonRef }).jpeg());
  for (const offset of [37, 61]) {
    const f = fixture(); f.tiff[offset] = 32; expectInvalid(f.jpeg());
  }
  for (const offset of [32, 56]) {
    const f = fixture(); f.u32(offset, 1); expectInvalid(f.jpeg());
  }
  for (const tag of [1, 2, 3, 4]) {
    const f = fixture(); f.u16(28 + (tag - 1) * 12, 20 + tag); expectInvalid(f.jpeg());
  }
});

test("rejects duplicate and contradictory tags and multiple GPS pointers", () => {
  const duplicate = fixture(); duplicate.u16(40, 1); expectInvalid(duplicate.jpeg());
  const rootDuplicate = fixture();
  rootDuplicate.u16(8, 2); rootDuplicate.tiff.copyWithin(22, 10, 22);
  expectInvalid(rootDuplicate.jpeg());
  for (const same of [true, false]) {
    const first = fixture(); const second = fixture({ lonRef: same ? "E" : "W" });
    expectInvalid(join(SOI, segment(0xe1, join(EXIF, first.tiff)), segment(0xe1, join(EXIF, second.tiff)), EOI));
  }
  const recursive = fixture(); recursive.u16(28, 0x8825); expectInvalid(recursive.jpeg());
});

test("rejects malformed TIFF byte order, version, pointers, directory lengths and data bounds", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.tiff[0] = 0; },
    (f: ReturnType<typeof fixture>) => f.u16(2, 43),
    (f: ReturnType<typeof fixture>) => f.u32(4, 0),
    (f: ReturnType<typeof fixture>) => f.u32(4, 0xffffffff),
    (f: ReturnType<typeof fixture>) => f.u16(8, 0xffff),
    (f: ReturnType<typeof fixture>) => f.u16(26, 0xffff),
    (f: ReturnType<typeof fixture>) => f.u16(12, 3),
    (f: ReturnType<typeof fixture>) => f.u32(14, 2),
    (f: ReturnType<typeof fixture>) => f.u32(18, 0),
    (f: ReturnType<typeof fixture>) => f.u32(18, 8),
    (f: ReturnType<typeof fixture>) => f.u32(18, 0xffffffff),
    (f: ReturnType<typeof fixture>) => f.u32(22, 8),
    (f: ReturnType<typeof fixture>) => f.u32(22, 0xffffffff),
    (f: ReturnType<typeof fixture>) => f.u32(76, 26),
    (f: ReturnType<typeof fixture>) => f.u32(48, 4),
    (f: ReturnType<typeof fixture>) => f.u32(48, 28),
    (f: ReturnType<typeof fixture>) => f.u32(48, 140),
    (f: ReturnType<typeof fixture>) => f.u32(48, 0xffffffff),
  ]) { const f = fixture(); mutate(f); expectInvalid(f.jpeg()); }
});

test("GPS offsets cannot escape APP1 into adjacent valid-looking bytes", () => {
  const f = fixture();
  const short = f.tiff.subarray(0, 100); // Longitude data at 104 is outside this APP1.
  expectInvalid(join(SOI, segment(0xe1, join(EXIF, short)), segment(0xe2, f.tiff), EOI));
});

test("does not follow thumbnail or other EXIF IFDs to invent GPS", () => {
  const f = fixture({ gps: false });
  f.u32(10, 26); // Valid next-directory address, deliberately not followed.
  f.u16(26, 1); f.u16(28, 0x8825); f.u16(30, 4); f.u32(32, 1); f.u32(36, 80);
  assert.equal(parsePhotoLocation(f.jpeg()).status, "missing");
});

test("reports absent GPS and ignores non-Exif APP1 and JPEG image data", () => {
  for (const bytes of [
    join(SOI, EOI), fixture({ gps: false }).jpeg(),
    join(SOI, segment(0xe1, Uint8Array.of(1, 2, 3)), EOI),
    join(SOI, SOS, fixture().jpeg()),
  ]) {
    const result = parsePhotoLocation(bytes);
    assert.equal(result.status, "missing");
    assert.match(result.message, /map|manually/);
  }
  const f = fixture();
  assert.equal(parsePhotoLocation(join(SOI, segment(0xe0, new Uint8Array(12)), segment(0xe1, join(EXIF, f.tiff)), SOS, Uint8Array.of(0, 0xff, 0, 10))).status, "located");
});

test("handles legal marker fill and TEM, but rejects illegal pre-scan markers", () => {
  const jpeg = fixture().jpeg();
  assert.equal(parsePhotoLocation(join(SOI, Uint8Array.of(0xff, 0x01, 0xff), jpeg.subarray(2))).status, "located");
  for (const marker of [0, 0xd0, 0xd7, 0xd8]) expectInvalid(join(SOI, Uint8Array.of(0xff, marker), EOI));
});

test("rejects every truncated prefix of a GPS JPEG without throwing", () => {
  for (const little of [true, false]) {
    const bytes = fixture({ little }).jpeg();
    for (let end = 2; end < bytes.length; end++) expectInvalid(bytes.subarray(0, end));
  }
  for (const bytes of [join(SOI, Uint8Array.of(0xff, 0xe1, 0, 0)), join(SOI, Uint8Array.of(0xff, 0xe1, 0, 1)), join(SOI, Uint8Array.of(0xff, 0xda, 0, 8, 1))]) expectInvalid(bytes);
});

test("enforces prefix, segment and total directory work limits", () => {
  const large = segment(0xe2, new Uint8Array(65530));
  const bytes = join(SOI, large, large, large, large, fixture().jpeg().subarray(2));
  assert.ok(bytes.length > PHOTO_HEADER_BYTES);
  expectInvalid(bytes);
  const small = fixture().jpeg();
  const exact = join(small, new Uint8Array(PHOTO_MAX_BYTES - small.length));
  assert.equal(exact.length, PHOTO_MAX_BYTES);
  assert.equal(parsePhotoLocation(exact).status, "located");
  expectInvalid(join(SOI, ...Array.from({ length: 1025 }, () => Uint8Array.of(0xff, 0x01)), EOI));
  const many = new Uint8Array(8 + 2 + 257 * 12 + 4);
  many.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 1]);
  expectInvalid(join(SOI, segment(0xe1, join(EXIF, many)), EOI));
  const full = new Uint8Array(8 + 2 + 256 * 12 + 4);
  const view = new DataView(full.buffer);
  full.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 1]);
  for (let i = 0; i < 256; i++) {
    const at = 10 + i * 12;
    view.setUint16(at, 0x1000 + i, true); view.setUint16(at + 2, 4, true); view.setUint32(at + 4, 1, true);
  }
  const fullSegment = segment(0xe1, join(EXIF, full));
  assert.equal(parsePhotoLocation(join(SOI, fullSegment, fullSegment, EOI)).status, "missing");
  expectInvalid(join(SOI, fullSegment, fullSegment, fullSegment, EOI));
});

test("recognizes PNG/WebP as unsupported and never promises metadata support for HEIC", () => {
  for (const [bytes, name] of [
    [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), "PNG"],
    [Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50), "WebP"],
    [Uint8Array.of(0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63), "This file's"],
    [new Uint8Array(), "This file's"],
  ] as const) {
    const result = parsePhotoLocation(bytes);
    assert.equal(result.status, "unsupported");
    assert.ok(result.message.startsWith(name)); assert.match(result.message, /manually/);
    assert.equal("point" in result, false);
  }
});

test("deterministic random bytes and mutated JPEG headers never throw or emit invalid coordinates", () => {
  let seed = 0x12345678;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let i = 0; i < 2500; i++) {
    const bytes = i % 2 === 0 ? fixture({ little: i % 4 === 0 }).jpeg() : new Uint8Array(random() % 512);
    if (i % 2 === 1) for (let j = 0; j < bytes.length; j++) bytes[j] = random() & 255;
    else for (let j = 0; j < 1 + random() % 6; j++) bytes[random() % bytes.length] = random() & 255;
    const result = parsePhotoLocation(bytes);
    assert.ok(["located", "missing", "unsupported", "invalid"].includes(result.status));
    if (result.status === "located") {
      assert.ok(Number.isFinite(result.point.latitude) && Math.abs(result.point.latitude) <= 90);
      assert.ok(Number.isFinite(result.point.longitude) && Math.abs(result.point.longitude) <= 180);
      assert.deepEqual(Object.keys(result).sort(), ["point", "status"]);
      assert.deepEqual(Object.keys(result.point).sort(), ["latitude", "longitude"]);
    }
  }
});

test("strict manual coordinates preserve precision, order, signs, zero and full latitude boundaries", () => {
  for (const [lat, lon, latitude, longitude] of [
    ["0", "-0", 0, 0], [" 35.123456789 ", "+51.25", 35.123456789, 51.25],
    ["-90", "180", -90, 180], ["90", "-180", 90, -180], ["+.5", "-0.125", 0.5, -0.125], ["1.", "2", 1, 2],
  ] as const) assert.deepEqual(parsePhotoPoint(lat, lon), { longitude, latitude });
});

test("strict manual coordinates reject blanks, partial, nondecimal, nonfinite and out-of-range strings", () => {
  for (const bad of ["", " ", "1e1", "0x10", "NaN", "Infinity", "-Infinity", "1,5", "1 N", "1°", "1foo", "1 2", "--1", "+", ".", "1_000", "1\n2", "9".repeat(400)]) {
    assert.equal(parsePhotoPoint(bad, "0"), null, bad);
    assert.equal(parsePhotoPoint("0", bad), null, bad);
  }
  for (const [lat, lon] of [["90.00001", "0"], ["-90.00001", "0"], ["0", "180.00001"], ["0", "-180.00001"]]) assert.equal(parsePhotoPoint(lat, lon), null);
});


test("explicit non-WGS84 or malformed survey datum is refused, with bounded WGS84 variants accepted", () => {
  for (const little of [true, false]) for (const datum of ["WGS-84", "WGS 84", "WGS84", "Tokyo", "NAD27", "WGS84\0junk"]) {
    const f = fixture({ little }), tiff = new Uint8Array(220);
    tiff.set(f.tiff);
    const view = new DataView(tiff.buffer);
    tiff.set(f.tiff.slice(80, 104), 104); tiff.set(f.tiff.slice(104, 128), 128);
    view.setUint16(26, 5, little);
    view.setUint32(48, 104, little); view.setUint32(72, 128, little);
    view.setUint16(76, 0x12, little); view.setUint16(78, 2, little);
    view.setUint32(80, datum.length + 1, little); view.setUint32(84, 160, little);
    view.setUint32(88, 0, little);
    tiff.set([...datum].map(c => c.charCodeAt(0)), 160);
    const result = parsePhotoLocation(join(SOI, segment(0xe1, join(EXIF, tiff)), EOI));
    assert.equal(result.status, ["WGS-84", "WGS 84", "WGS84"].includes(datum) ? "located" : "invalid", datum);
  }
});
