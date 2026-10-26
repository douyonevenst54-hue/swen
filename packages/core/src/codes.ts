/**
 * QR / barcode contents for traceability. Every label carries a short prefix
 * so a scan can never be mistaken for the wrong kind of thing:
 *
 *   SWEN:PT:<patient id>      patient wristband
 *   SWEN:ST:<staff id>        staff badge
 *   SWEN:DV:<device id>       tablet / phone running Swen
 *   SWEN:EQ:<equipment code>  measuring instrument (oximeter, BP cuff, thermometer)
 *   SWEN:ITEM:<item code>     supply item (any plain barcode is also treated as an item code)
 */
export type CodeKind = "patient" | "staff" | "device" | "equipment" | "item";

const PREFIX: Record<CodeKind, string> = {
  patient: "SWEN:PT:",
  staff: "SWEN:ST:",
  device: "SWEN:DV:",
  equipment: "SWEN:EQ:",
  item: "SWEN:ITEM:",
};

export function codePayload(kind: CodeKind, value: string): string {
  return PREFIX[kind] + value;
}

export interface ScannedCode {
  kind: CodeKind;
  value: string;
}

/** Plain barcodes (e.g. a manufacturer GTIN) are read as supply item codes. */
export function parseScannedCode(raw: string): ScannedCode {
  const text = raw.trim();
  const upper = text.toUpperCase();
  for (const kind of Object.keys(PREFIX) as CodeKind[]) {
    if (upper.startsWith(PREFIX[kind])) return { kind, value: text.slice(PREFIX[kind].length).trim() };
  }
  return { kind: "item", value: text };
}

/** Which vital signs an instrument of each kind measures. */
export const EQUIPMENT_KINDS = ["oximeter", "bp", "thermometer", "other"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_MEASURES: Record<EquipmentKind, ("rr" | "hr" | "sbp" | "dbp" | "tempC" | "spo2")[]> = {
  oximeter: ["spo2", "hr"],
  bp: ["sbp", "dbp", "hr"],
  thermometer: ["tempC"],
  other: [],
};
