import { describe, expect, it } from "vitest";
import {
  parseBloodPressureMeasurement,
  parseHeartRateMeasurement,
  parsePlxMeasurement,
  createStabilityFilter,
  parseTemperatureMeasurement,
  readFloat32,
  readSfloat,
} from "../src/gatt";

function view(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

/** Encode an SFLOAT (mantissa, exponent) little-endian. */
function sfloat(mantissa: number, exponent: number): number[] {
  const raw = ((exponent & 0xf) << 12) | (mantissa & 0x0fff);
  return [raw & 0xff, raw >> 8];
}

/** Encode a FLOAT32 (mantissa, exponent) little-endian. */
function float32(mantissa: number, exponent: number): number[] {
  const raw = (((exponent & 0xff) << 24) | (mantissa & 0xffffff)) >>> 0;
  return [raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, raw >>> 24];
}

describe("IEEE 11073 numbers", () => {
  it("reads SFLOAT positive, negative exponent and special values", () => {
    expect(readSfloat(view(sfloat(120, 0)), 0)).toBe(120);
    expect(readSfloat(view(sfloat(375, -1)), 0)).toBe(37.5);
    expect(readSfloat(view(sfloat(-5, 0)), 0)).toBe(-5);
    expect(readSfloat(view([0xff, 0x07]), 0)).toBeNull(); // NaN
  });

  it("reads FLOAT32", () => {
    expect(readFloat32(view(float32(3685, -2)), 0)).toBe(36.85);
    expect(readFloat32(view(float32(-12, 0)), 0)).toBe(-12);
  });
});

describe("Health Thermometer 0x2A1C", () => {
  it("parses Celsius", () => {
    expect(parseTemperatureMeasurement(view([0x00, ...float32(372, -1)]))).toEqual({ tempC: 37.2 });
  });
  it("converts Fahrenheit to Celsius", () => {
    expect(parseTemperatureMeasurement(view([0x01, ...float32(986, -1)]))).toEqual({ tempC: 37 });
  });
  it("rejects short packets", () => {
    expect(parseTemperatureMeasurement(view([0x00, 1, 2]))).toBeNull();
  });
});

describe("Blood Pressure 0x2A35", () => {
  it("parses mmHg with timestamp and pulse", () => {
    const flags = 0b0000_0110; // mmHg, timestamp present, pulse present
    const timestamp = [0xea, 0x07, 10, 25, 9, 30, 0];
    const bytes = [flags, ...sfloat(128, 0), ...sfloat(84, 0), ...sfloat(99, 0), ...timestamp, ...sfloat(72, 0)];
    expect(parseBloodPressureMeasurement(view(bytes))).toEqual({ sbp: 128, dbp: 84, map: 99, hr: 72 });
  });
  it("converts kPa", () => {
    const bytes = [0x01, ...sfloat(160, -1), ...sfloat(107, -1), ...sfloat(125, -1)];
    const r = parseBloodPressureMeasurement(view(bytes))!;
    expect(r.sbp).toBe(120);
    expect(r.dbp).toBe(80);
    expect(r.hr).toBeNull();
  });
});

describe("Pulse oximeter PLX", () => {
  it("parses SpO2 and pulse rate", () => {
    expect(parsePlxMeasurement(view([0x00, ...sfloat(97, 0), ...sfloat(68, 0)]))).toEqual({ spo2: 97, hr: 68, unreliable: false });
  });
  it("flags samples the device marks as still measuring or questionable", () => {
    // Continuous, Measurement Status present (flag bit 2), "measurement ongoing" (bit 5)
    const ongoing = parsePlxMeasurement(view([0x04, ...sfloat(91, 0), ...sfloat(70, 0), 0x20, 0x00]), "continuous")!;
    expect(ongoing.unreliable).toBe(true);
    // Spot-check with timestamp (bit 0) and status (bit 1) = "validated data" (bit 7) only
    const ok = parsePlxMeasurement(view([0x03, ...sfloat(97, 0), ...sfloat(66, 0), 0xea, 0x07, 10, 25, 9, 30, 0, 0x80, 0x00]), "spot")!;
    expect(ok).toEqual({ spo2: 97, hr: 66, unreliable: false });
  });
  it("waits for stable consecutive readings", () => {
    const f = createStabilityFilter(3);
    const r = (spo2: number, hr: number, unreliable = false) => ({ spo2, hr, unreliable });
    expect(f(r(88, 90))).toBeNull();
    expect(f(r(95, 72))).toBeNull();
    expect(f(r(96, 71))).toBeNull(); // 88 still in window
    expect(f(r(96, 72))).toEqual(r(96, 72));
    expect(f(r(96, 72, true))).toBeNull(); // unreliable resets
  });
});

describe("Heart Rate 0x2A37", () => {
  it("parses 8-bit and 16-bit values", () => {
    expect(parseHeartRateMeasurement(view([0x00, 75]))).toEqual({ hr: 75 });
    expect(parseHeartRateMeasurement(view([0x01, 0x2c, 0x01]))).toEqual({ hr: 300 });
  });
});
