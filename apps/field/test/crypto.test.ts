import { describe, expect, it } from "vitest";
import { open, seal, unwrapDataKey, wrapDataKey } from "../src/lib/crypto";
import { wrappedKeyStillValid } from "../src/lib/session";

describe("device key wrapping", () => {
  it("unwraps with the right PIN only", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
    const wrapped = await wrapDataKey(raw, "1234", 1000);
    const key = await unwrapDataKey(wrapped, "1234");
    expect(key).not.toBeNull();
    expect(await unwrapDataKey(wrapped, "4321")).toBeNull();

    const sealed = await seal(key!, { givenName: "Jak", familyName: "Pyè" });
    expect(sealed.ct).not.toContain("Jak");
    expect(await open(key!, sealed)).toEqual({ givenName: "Jak", familyName: "Pyè" });
  });
});

describe("offline unlock validity", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("expires after 30 days and after a PIN change", () => {
    expect(wrappedKeyStillValid({ wrappedAt: "2026-10-20T12:00:00Z" }, { pinSetAt: "2026-01-01T00:00:00Z" }, now)).toBe(true);
    expect(wrappedKeyStillValid({ wrappedAt: "2026-09-01T12:00:00Z" }, {}, now)).toBe(false);
    expect(wrappedKeyStillValid({ wrappedAt: "2026-10-20T12:00:00Z" }, { pinSetAt: "2026-10-21T00:00:00Z" }, now)).toBe(false);
    expect(wrappedKeyStillValid({}, {}, now)).toBe(false);
  });
});
