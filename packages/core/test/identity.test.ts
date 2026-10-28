import { describe, expect, it } from "vitest";
import { birthYearFrom, findLikelyDuplicates, nameMatchScore, searchPeople, soundKey } from "../src/identity";
import { canMove, compareQueue, localDay, minutesPastTarget } from "../src/visits";
import { PatientSchema, VisitSchema, type Visit } from "../src/schemas";

describe("sound keys for Haitian names", () => {
  const same = [
    ["Pierre", "Pyè"],
    ["Jean", "Jan"],
    ["Joseph", "Jozèf"],
    ["Baptiste", "Batis"],
    ["Louis", "Lwi"],
    ["Marie", "Mari"],
    ["Philippe", "Filip"],
    ["Jacques", "Jak"],
    ["Thérèse", "Terez"],
    ["Michel", "Michèl"],
    ["Claude", "Klod"],
    ["Paul", "Pòl"],
  ];
  it.each(same)("%s sounds like %s", (a, b) => {
    expect(soundKey(a)).toBe(soundKey(b));
  });
  it("keeps clearly different names apart", () => {
    expect(soundKey("Pierre")).not.toBe(soundKey("Paul"));
    expect(soundKey("Marie")).not.toBe(soundKey("Mario"));
    expect(soundKey("Jean")).not.toBe(soundKey("Joan"));
  });
});

const people = [
  { id: "1", givenName: "Jean-Baptiste", familyName: "Pierre", sex: "M", birthYear: 1975, birthDatePrecision: "year" as const, phone: "+509 3712 4455", motherName: "Rose", commune: "Mirebalais" },
  { id: "2", givenName: "Marie", familyName: "Desir", otherNames: "Marie Joseph", sex: "F", birthYear: 1990, birthDatePrecision: "exact" as const, phone: null, motherName: "Anne", commune: "Hinche" },
  { id: "3", givenName: "Jean", familyName: "Pierre", sex: "M", birthYear: 2015, birthDatePrecision: "exact" as const, phone: null },
  { id: "4", givenName: "Wilner", familyName: "Jean-Louis", sex: "M", birthYear: 1962, birthDatePrecision: "estimated" as const, phone: "37005566" },
];

describe("search by name", () => {
  it("finds a person from a Kreyòl spelling of a French name", () => {
    const r = searchPeople(people, { text: "Jan Batis Pyè" });
    expect(r[0]?.person.id).toBe("1");
  });
  it("accepts family name first and a half-typed last word", () => {
    expect(searchPeople(people, { text: "desir mar" })[0]?.person.id).toBe("2");
  });
  it("searches other names (maiden or married name)", () => {
    expect(searchPeople(people, { text: "Marie Jozèf" }).map((m) => m.person.id)).toContain("2");
  });
  it("narrows by birth year with a tolerance", () => {
    const r = searchPeople(people, { text: "Jean Pierre", birthYear: 1976 });
    expect(r.map((m) => m.person.id)).toEqual(["1"]);
  });
  it("finds by phone number", () => {
    expect(searchPeople(people, { text: "3712 4455" })[0]?.person.id).toBe("1");
  });
  it("does not match unrelated names", () => {
    expect(searchPeople(people, { text: "Fritznel" })).toEqual([]);
    expect(nameMatchScore("Paul", ["Pierre", "Jean"])).toBe(0);
  });
});

describe("duplicate check at registration", () => {
  it("flags the same person spelled differently, born the same year", () => {
    const d = findLikelyDuplicates({ givenName: "Jan Batis", familyName: "Pyè", sex: "M", birthYear: 1975, birthDatePrecision: "year" }, people);
    expect(d[0]?.person.id).toBe("1");
    expect(d[0]?.reasons).toEqual(expect.arrayContaining(["name", "birth"]));
  });
  it("does not flag a child with the same name as his father", () => {
    const d = findLikelyDuplicates({ givenName: "Jean", familyName: "Pierre", sex: "M", birthYear: 1975, birthDatePrecision: "year" }, people);
    expect(d.map((x) => x.person.id)).not.toContain("3");
  });
  it("names given in the other order still match", () => {
    const d = findLikelyDuplicates({ givenName: "Desir", familyName: "Marie", sex: "F" }, people);
    expect(d[0]?.person.id).toBe("2");
  });
  it("an estimated age allows a wider gap", () => {
    const d = findLikelyDuplicates({ givenName: "Wilner", familyName: "Jean Louis", sex: "M", birthYear: 1959, birthDatePrecision: "estimated" }, people);
    expect(d[0]?.person.id).toBe("4");
  });
  it("a different sex is not the same person", () => {
    expect(findLikelyDuplicates({ givenName: "Marie", familyName: "Desir", sex: "M" }, people)).toEqual([]);
  });
});

describe("birth year from what is known", () => {
  const today = new Date("2026-10-28T12:00:00Z");
  it("handles exact date, year only and estimated age", () => {
    expect(birthYearFrom({ precision: "exact", date: "1984-03-02" }, today)).toBe(1984);
    expect(birthYearFrom({ precision: "year", year: 1990 }, today)).toBe(1990);
    expect(birthYearFrom({ precision: "estimated", age: 40 }, today)).toBe(1986);
    expect(birthYearFrom({ precision: "estimated", age: null }, today)).toBeNull();
  });
});

describe("queue", () => {
  const base = (over: Partial<Visit>): Visit =>
    VisitSchema.parse({
      id: crypto.randomUUID(),
      patientId: crypto.randomUUID(),
      kind: "outpatient",
      service: "Konsiltasyon",
      status: "waiting",
      arrivedAt: "2026-10-28T13:00:00Z",
      createdAt: "2026-10-28T13:00:00Z",
      createdBy: crypto.randomUUID(),
      updatedAt: "2026-10-28T13:00:00Z",
      updatedBy: crypto.randomUUID(),
      ...over,
    });
  it("puts emergencies and urgent colours first, then longest wait", () => {
    const green = base({ status: "triaged", triageColor: "green", arrivedAt: "2026-10-28T12:00:00Z" });
    const orange = base({ status: "triaged", triageColor: "orange", arrivedAt: "2026-10-28T13:30:00Z" });
    const emergency = base({ kind: "emergency", status: "triaged", triageColor: "yellow" });
    const early = base({ arrivedAt: "2026-10-28T11:00:00Z" });
    const late = base({ arrivedAt: "2026-10-28T14:00:00Z" });
    expect([late, green, early, orange, emergency].sort(compareQueue)).toEqual([emergency, orange, green, early, late]);
  });
  it("flags a patient waiting past the colour's target", () => {
    const v = base({ status: "triaged", triageColor: "orange", arrivedAt: "2026-10-28T13:00:00Z" });
    expect(minutesPastTarget(v, Date.parse("2026-10-28T13:25:00Z"))).toBe(15);
    expect(minutesPastTarget(v, Date.parse("2026-10-28T13:05:00Z"))).toBeNull();
  });
  it("uses the Haiti calendar day, not UTC", () => {
    expect(localDay("2026-10-29T02:00:00Z")).toBe("2026-10-28");
  });
  it("only allows sensible status changes", () => {
    expect(canMove("waiting", "triaged")).toBe(true);
    expect(canMove("done", "waiting")).toBe(false);
  });
  it("patients without a ward are valid (outpatients)", () => {
    const p = PatientSchema.safeParse({
      id: crypto.randomUUID(),
      ward: "",
      givenName: "Jak",
      familyName: "Pyè",
      sex: "M",
      createdAt: "2026-10-28T13:00:00Z",
      updatedAt: "2026-10-28T13:00:00Z",
      updatedBy: crypto.randomUUID(),
    });
    expect(p.success).toBe(true);
  });
});
