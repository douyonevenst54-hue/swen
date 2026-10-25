/**
 * Read measurements from Bluetooth Low Energy devices that implement the
 * standard Bluetooth SIG health profiles (see packages/core/src/gatt.ts).
 *
 * Works in Chrome on Android (installed PWA or browser tab). Not available in
 * iOS Safari or in Android WebViews — the app falls back to typing values.
 */
import {
  createStabilityFilter,
  GATT,
  parseBloodPressureMeasurement,
  parseHeartRateMeasurement,
  parsePlxMeasurement,
  parseTemperatureMeasurement,
} from "@swen/core";

export type BleKind = "thermometer" | "bp" | "oximeter" | "hr";

export interface BleReading {
  tempC?: number;
  sbp?: number;
  dbp?: number;
  hr?: number;
  spo2?: number;
  deviceName: string;
}

type Parser = (v: DataView, characteristic: number) => Omit<BleReading, "deviceName"> | null;

/** Each read gets fresh parsers, so stateful filters (oximeter stability) start clean. */
const PROFILES: Record<BleKind, { service: number; characteristics: number[]; parser: () => Parser }> = {
  thermometer: {
    service: GATT.services.healthThermometer,
    characteristics: [GATT.characteristics.temperatureMeasurement],
    parser: () => (v) => parseTemperatureMeasurement(v),
  },
  bp: {
    service: GATT.services.bloodPressure,
    characteristics: [GATT.characteristics.bloodPressureMeasurement],
    parser: () => (v) => {
      const r = parseBloodPressureMeasurement(v);
      return r ? { sbp: r.sbp, dbp: r.dbp, ...(r.hr != null ? { hr: r.hr } : {}) } : null;
    },
  },
  oximeter: {
    service: GATT.services.pulseOximeter,
    characteristics: [GATT.characteristics.plxSpotCheck, GATT.characteristics.plxContinuous],
    parser: () => {
      // Spot-check gives one final value. Continuous streams settle over time:
      // skip samples the device flags and wait for three that agree.
      const stable = createStabilityFilter(3);
      return (v, ch) => {
        const continuous = ch === GATT.characteristics.plxContinuous;
        const r = parsePlxMeasurement(v, continuous ? "continuous" : "spot");
        if (!r || r.unreliable) return null;
        const ok = continuous ? stable(r) : r;
        return ok ? { spo2: ok.spo2, ...(ok.hr != null ? { hr: ok.hr } : {}) } : null;
      };
    },
  },
  hr: {
    service: GATT.services.heartRate,
    characteristics: [GATT.characteristics.heartRateMeasurement],
    parser: () => (v) => parseHeartRateMeasurement(v),
  },
};

export function bleSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator && !!navigator.bluetooth;
}

/**
 * Ask the user to pick a device, then wait for the first valid measurement.
 * Rejects with AbortError if `signal` aborts (e.g. user taps Cancel).
 */
export async function readOnce(kind: BleKind, signal: AbortSignal, timeoutMs = 120_000): Promise<BleReading> {
  if (!bleSupported()) throw new Error("unsupported");
  const profile = PROFILES[kind];
  const parse = profile.parser();
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [profile.service] }] });
  const server = await device.gatt!.connect();
  const cleanup = () => {
    try {
      server.disconnect();
    } catch {
      /* already gone */
    }
  };
  try {
    const service = await server.getPrimaryService(profile.service);
    return await new Promise<BleReading>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
      let failed = 0;
      for (const uuid of profile.characteristics) {
        service
          .getCharacteristic(uuid)
          .then(async (ch) => {
            ch.addEventListener("characteristicvaluechanged", () => {
              const reading = ch.value ? parse(ch.value, uuid) : null;
              if (reading) {
                clearTimeout(timer);
                resolve({ ...reading, deviceName: device.name ?? kind });
              }
            });
            await ch.startNotifications();
          })
          .catch(() => {
            // Devices implement only some of the optional characteristics; fail only if none work.
            if (++failed === profile.characteristics.length) {
              clearTimeout(timer);
              reject(new Error("no supported measurement on this device"));
            }
          });
      }
    });
  } finally {
    cleanup();
  }
}
