/**
 * Parsers for standard Bluetooth Low Energy health profiles (Bluetooth SIG
 * GATT specifications). Any device that implements these standard services
 * works without vendor SDKs:
 *
 *   Health Thermometer  service 0x1809  char 0x2A1C Temperature Measurement
 *   Blood Pressure      service 0x1810  char 0x2A35 Blood Pressure Measurement
 *   Pulse Oximeter      service 0x1822  char 0x2A5E PLX Spot-Check, 0x2A5F PLX Continuous
 *   Heart Rate          service 0x180D  char 0x2A37 Heart Rate Measurement
 *
 * Many very cheap oximeters use proprietary protocols instead; check the BOM in
 * hardware/README.md for devices known to implement the standard profiles.
 */

export const GATT = {
  services: {
    healthThermometer: 0x1809,
    bloodPressure: 0x1810,
    pulseOximeter: 0x1822,
    heartRate: 0x180d,
  },
  characteristics: {
    temperatureMeasurement: 0x2a1c,
    bloodPressureMeasurement: 0x2a35,
    plxSpotCheck: 0x2a5e,
    plxContinuous: 0x2a5f,
    heartRateMeasurement: 0x2a37,
  },
} as const;

/** IEEE 11073-20601 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa. */
export function readSfloat(view: DataView, offset: number): number | null {
  const raw = view.getUint16(offset, true);
  // Reserved special values: NaN, NRes, +INF, -INF, reserved.
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x07fe || raw === 0x0802 || raw === 0x0801) return null;
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  if (exponent >= 0x8) exponent -= 0x10;
  return roundTo(mantissa * Math.pow(10, exponent), 4);
}

/** IEEE 11073-20601 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa. */
export function readFloat32(view: DataView, offset: number): number | null {
  const raw = view.getUint32(offset, true);
  let mantissa = raw & 0x00ffffff;
  let exponent = raw >>> 24;
  // Reserved: NaN 0x007FFFFF, NRes 0x00800000, +INF 0x007FFFFE, -INF 0x00800002, reserved 0x00800001
  if ([0x007fffff, 0x00800000, 0x007ffffe, 0x00800002, 0x00800001].includes(mantissa) && exponent === 0) return null;
  if (mantissa >= 0x00800000) mantissa -= 0x01000000;
  if (exponent >= 0x80) exponent -= 0x100;
  return roundTo(mantissa * Math.pow(10, exponent), 4);
}

function roundTo(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export interface TemperatureReading {
  tempC: number;
}

export function parseTemperatureMeasurement(view: DataView): TemperatureReading | null {
  if (view.byteLength < 5) return null;
  const flags = view.getUint8(0);
  const value = readFloat32(view, 1);
  if (value == null) return null;
  const fahrenheit = (flags & 0x01) === 1;
  const tempC = fahrenheit ? roundTo(((value - 32) * 5) / 9, 1) : roundTo(value, 1);
  return { tempC };
}

export interface BloodPressureReading {
  sbp: number;
  dbp: number;
  map: number | null;
  hr: number | null;
}

export function parseBloodPressureMeasurement(view: DataView): BloodPressureReading | null {
  if (view.byteLength < 7) return null;
  const flags = view.getUint8(0);
  const kpa = (flags & 0x01) === 1;
  const hasTimestamp = (flags & 0x02) !== 0;
  const hasPulse = (flags & 0x04) !== 0;
  const sys = readSfloat(view, 1);
  const dia = readSfloat(view, 3);
  const map = readSfloat(view, 5);
  if (sys == null || dia == null) return null;
  const toMmHg = (v: number) => (kpa ? Math.round(v * 7.50062) : Math.round(v));
  let offset = 7;
  if (hasTimestamp) offset += 7;
  let hr: number | null = null;
  if (hasPulse && view.byteLength >= offset + 2) {
    const p = readSfloat(view, offset);
    hr = p == null ? null : Math.round(p);
  }
  return { sbp: toMmHg(sys), dbp: toMmHg(dia), map: map == null ? null : toMmHg(map), hr };
}

export interface OximetryReading {
  spo2: number;
  hr: number | null;
  /** The device marked this sample as not final (still measuring, early estimate, questionable, invalid, demo…). */
  unreliable: boolean;
}

/** Measurement Status bits meaning "do not use this value yet". */
const PLX_STATUS_UNRELIABLE =
  (1 << 5) | // measurement ongoing
  (1 << 6) | // early estimated data
  (1 << 10) | // data for demonstration
  (1 << 11) | // data for testing
  (1 << 12) | // calibration ongoing
  (1 << 13) | // measurement unavailable
  (1 << 14) | // questionable measurement detected
  (1 << 15); // invalid measurement detected

/**
 * PLX Spot-Check (0x2A5E) and PLX Continuous (0x2A5F). Both start with flags,
 * SpO2, PR; the optional fields before the Measurement Status differ.
 */
export function parsePlxMeasurement(view: DataView, kind: "spot" | "continuous" = "spot"): OximetryReading | null {
  if (view.byteLength < 5) return null;
  const flags = view.getUint8(0);
  const spo2 = readSfloat(view, 1);
  const pr = readSfloat(view, 3);
  if (spo2 == null) return null;
  let offset = 5;
  let statusPresent: boolean;
  if (kind === "spot") {
    if (flags & 0x01) offset += 7; // timestamp
    statusPresent = (flags & 0x02) !== 0;
  } else {
    if (flags & 0x01) offset += 4; // SpO2PR-Fast
    if (flags & 0x02) offset += 4; // SpO2PR-Slow
    statusPresent = (flags & 0x04) !== 0;
  }
  let unreliable = false;
  if (statusPresent) {
    if (view.byteLength < offset + 2) return null;
    unreliable = (view.getUint16(offset, true) & PLX_STATUS_UNRELIABLE) !== 0;
  }
  return { spo2: Math.round(spo2), hr: pr == null ? null : Math.round(pr), unreliable };
}

/**
 * Continuous oximeters stream values that settle over several seconds.
 * Accept a value only after `needed` consecutive reliable samples agree
 * within ±1 % SpO2 and ±3 bpm.
 */
export function createStabilityFilter(needed = 3) {
  const recent: OximetryReading[] = [];
  return (r: OximetryReading): OximetryReading | null => {
    if (r.unreliable) {
      recent.length = 0;
      return null;
    }
    recent.push(r);
    if (recent.length > needed) recent.shift();
    if (recent.length < needed) return null;
    const spo2s = recent.map((x) => x.spo2);
    const hrs = recent.map((x) => x.hr).filter((x): x is number => x != null);
    const stable = Math.max(...spo2s) - Math.min(...spo2s) <= 1 && (hrs.length < needed || Math.max(...hrs) - Math.min(...hrs) <= 3);
    return stable ? recent[recent.length - 1]! : null;
  };
}

export function parseHeartRateMeasurement(view: DataView): { hr: number } | null {
  if (view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  const sixteenBit = (flags & 0x01) === 1;
  if (sixteenBit && view.byteLength < 3) return null;
  const hr = sixteenBit ? view.getUint16(1, true) : view.getUint8(1);
  return { hr };
}
