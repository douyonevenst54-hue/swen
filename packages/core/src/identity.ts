/**
 * Patient identity: finding the right person by name and date of birth.
 *
 * Haitian registers mix French and Kreyòl spellings of the same name
 * (Pierre / Pyè, Jean / Jan, Joseph / Jozèf, Jean-Baptiste / Jan Batis), many
 * people know only their birth year or an estimated age, and women may be
 * registered under a maiden or a married name. Exact matching fails on all of
 * these, so names are compared by how they sound.
 */

export type BirthDatePrecision = "exact" | "year" | "estimated";

/** Lowercase, no accents, hyphens and apostrophes become spaces, single spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'’.,_/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const VOWELS = "aeiouy";
const isVowel = (c: string | undefined) => !!c && VOWELS.includes(c);

/**
 * Sound key for one word, tuned for French and Kreyòl spellings of Haitian
 * names. Two spellings that are pronounced alike get the same key.
 */
export function soundKey(word: string): string {
  let w = normalizeName(word).replace(/ /g, "");
  if (!w) return "";
  // Multi-letter spellings first.
  w = w
    .replace(/^h/, "")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/qu/g, "k")
    .replace(/gu(?=[eiy])/g, "g")
    .replace(/ge(?=[aou])/g, "j") // Georges → Jorj
    .replace(/ck/g, "k")
    .replace(/pt/g, "t") // Baptiste → Batis
    .replace(/eau/g, "o")
    .replace(/au/g, "o")
    .replace(/ou/g, "u")
    .replace(/oi/g, "wa")
    .replace(/(ai|ei)/g, "e")
    .replace(/ean/g, "an") // Jean → Jan
    .replace(/en(?![aeiouyn])/g, "an") // Laurent, Vincent → -an
    .replace(/em(?=[bp])/g, "an")
    .replace(/am(?=[bp])/g, "an")
    .replace(/om(?=[bp])/g, "on")
    .replace(/ille?$/g, "iy") // Camille → Kamiy
    .replace(/y/g, "i")
    .replace(/w(?=[aeiou])/g, "u") // Lwi → Lui
    .replace(/z/g, "s");

  // Letter by letter.
  let out = "";
  for (let i = 0; i < w.length; i++) {
    const c = w[i]!;
    const next = w[i + 1];
    const prev = w[i - 1];
    let k = c;
    if (c === "c") k = next && "ei".includes(next) ? "s" : "k";
    else if (c === "g" && next && "ei".includes(next)) k = "j";
    else if (c === "x") k = "ks";
    else if (c === "s" && isVowel(prev) && isVowel(next)) k = "s"; // Joseph = Jozèf: both become s
    out += k;
  }
  // Collapse doubled letters (Pierre → Piere).
  out = out.replace(/(.)\1+/g, "$1");
  // French endings that are not pronounced: a mute final e (not after a vowel:
  // the è of Pyè is spoken), then silent final consonants (Baptiste = Batis).
  for (let guard = 0; guard < 4; guard++) {
    const before = out;
    if (out.length > 2 && /[^aeiou]e$/.test(out)) out = out.slice(0, -1);
    if (out.length > 2 && /[tdxs]$/.test(out)) out = out.slice(0, -1);
    if (out === before) break;
  }
  if (out.length > 3 && out.endsWith("er")) out = out.slice(0, -1); // Roger = Woje, Pierre = Pyè
  if (out.length > 2 && out.endsWith("ie")) out = out.slice(0, -1); // Marie = Mari
  return out;
}

/** Sound keys for every word of a name. */
export function nameKeys(name: string | null | undefined): string[] {
  return normalizeName(name ?? "")
    .split(" ")
    .filter(Boolean)
    .map(soundKey)
    .filter(Boolean);
}

/** Jaro-Winkler similarity, 0 (nothing alike) to 1 (identical). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** How well one word matches: same sound = 1; typed prefix of a name = 0.9; else spelling closeness. */
function wordScore(query: string, candidate: string, prefixOk: boolean): number {
  if (query === candidate) return 1;
  if (prefixOk && query.length >= 2 && candidate.startsWith(query)) return 0.9;
  const s = jaroWinkler(query, candidate);
  return s >= 0.85 ? s * 0.9 : 0;
}

/**
 * Score 0..1 for how well a typed name matches a person's names. Every typed
 * word must match one of the person's words (in any order: people give names
 * family-first or given-first). The last typed word may be unfinished.
 */
export function nameMatchScore(query: string, personNames: (string | null | undefined)[]): number {
  const raw = normalizeName(query).split(" ").filter(Boolean);
  if (!raw.length) return 0;
  const q = raw.map(soundKey);
  const words = personNames.flatMap((n) => nameKeys(n));
  // Keep the plain spelling too, so a partly typed word still matches by prefix.
  const plain = personNames.flatMap((n) => normalizeName(n ?? "").split(" ").filter(Boolean));
  if (!words.length) return 0;
  let total = 0;
  for (let i = 0; i < q.length; i++) {
    const last = i === q.length - 1;
    let best = 0;
    for (const w of words) best = Math.max(best, wordScore(q[i]!, w, last));
    if (last) for (const p of plain) best = Math.max(best, wordScore(raw[i]!, p, true));
    if (best === 0) return 0;
    total += best;
  }
  return total / q.length;
}

export interface IdentityFields {
  givenName: string;
  familyName: string;
  otherNames?: string | null;
  sex?: string;
  birthYear?: number | null;
  birthDatePrecision?: BirthDatePrecision | null;
  phone?: string | null;
  motherName?: string | null;
  commune?: string | null;
  nationalId?: string | null;
}

/** How many years apart two recorded birth years may be and still be the same person. */
export function birthYearTolerance(a?: BirthDatePrecision | null, b?: BirthDatePrecision | null): number {
  if (a === "estimated" || b === "estimated") return 3;
  if (a === "exact" && b === "exact") return 0;
  return 1;
}

export interface SearchQuery {
  text: string;
  birthYear?: number | null;
  sex?: string | null;
}

export interface Match<T> {
  person: T;
  score: number;
}

/** Search a patient list by name (sound-alike), optionally narrowed by birth year and sex. */
export function searchPeople<T extends IdentityFields>(people: T[], query: SearchQuery, limit = 20): Match<T>[] {
  const text = query.text.trim();
  const digits = text.replace(/\D/g, "");
  const out: Match<T>[] = [];
  for (const p of people) {
    let score = 0;
    // A phone number or ID typed in the search box.
    if (digits.length >= 6) {
      if (p.phone && p.phone.replace(/\D/g, "").endsWith(digits)) score = 1;
      if (p.nationalId && p.nationalId.replace(/\W/g, "").toLowerCase().includes(text.replace(/\W/g, "").toLowerCase())) score = 1;
    }
    if (!score) score = nameMatchScore(text, [p.givenName, p.familyName, p.otherNames]);
    if (!score) continue;
    if (query.birthYear != null && p.birthYear != null) {
      const gap = Math.abs(query.birthYear - p.birthYear);
      const tol = Math.max(2, birthYearTolerance(p.birthDatePrecision, null));
      if (gap > tol) continue;
      score += gap === 0 ? 0.1 : 0;
    }
    if (query.sex && query.sex !== "U" && p.sex && p.sex !== "U" && p.sex !== query.sex) continue;
    out.push({ person: p, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface DuplicateMatch<T> {
  person: T;
  score: number;
  reasons: ("name" | "birth" | "phone" | "mother" | "commune" | "nationalId")[];
}

/**
 * Records that may be the same person as a new registration. Shown before the
 * record is created, with "Is this the same person?".
 */
export function findLikelyDuplicates<T extends IdentityFields & { id: string }>(candidate: IdentityFields, people: T[], limit = 5): DuplicateMatch<T>[] {
  const out: DuplicateMatch<T>[] = [];
  const candNames = [candidate.givenName, candidate.familyName, candidate.otherNames];
  const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");
  for (const p of people) {
    const reasons: DuplicateMatch<T>["reasons"] = [];
    // A national ID or phone number that matches is strong evidence on its own.
    if (candidate.nationalId && p.nationalId && candidate.nationalId.replace(/\W/g, "").toLowerCase() === p.nationalId.replace(/\W/g, "").toLowerCase()) reasons.push("nationalId");
    const phone = digits(candidate.phone);
    const samePhone = phone.length >= 8 && digits(p.phone).slice(-8) === phone.slice(-8);
    // Names must match both ways: given and family, in either order or through other names.
    const forward = Math.min(
      nameMatchScore(candidate.givenName, [p.givenName, p.familyName, p.otherNames]),
      nameMatchScore(candidate.familyName, [p.givenName, p.familyName, p.otherNames]),
    );
    const backward = Math.min(nameMatchScore(p.givenName, candNames), nameMatchScore(p.familyName, candNames));
    const nameScore = Math.max(forward, backward);
    if (nameScore >= 0.85) reasons.push("name");
    else if (!reasons.includes("nationalId")) continue;

    if (candidate.sex && p.sex && candidate.sex !== "U" && p.sex !== "U" && candidate.sex !== p.sex && !reasons.includes("nationalId")) continue;

    let score = reasons.includes("nationalId") ? 1 : nameScore * 0.6;
    if (candidate.birthYear != null && p.birthYear != null) {
      const gap = Math.abs(candidate.birthYear - p.birthYear);
      if (gap <= birthYearTolerance(candidate.birthDatePrecision, p.birthDatePrecision)) {
        reasons.push("birth");
        score += 0.25;
      } else if (gap > 5 && !reasons.includes("nationalId") && !samePhone) {
        continue; // same name, clearly a different generation
      }
    }
    if (samePhone) {
      reasons.push("phone");
      score += 0.2;
    }
    if (candidate.motherName && p.motherName && nameMatchScore(candidate.motherName, [p.motherName]) >= 0.85) {
      reasons.push("mother");
      score += 0.15;
    }
    if (candidate.commune && p.commune && normalizeName(candidate.commune) === normalizeName(p.commune)) {
      reasons.push("commune");
      score += 0.05;
    }
    out.push({ person: p, score: Math.min(1, score), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Birth year from what the receptionist knows: exact date, year, or estimated age. */
export function birthYearFrom(input: { precision: BirthDatePrecision; date?: string | null; year?: number | null; age?: number | null }, today: Date = new Date()): number | null {
  if (input.precision === "exact" && input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) return Number(input.date.slice(0, 4));
  if (input.precision === "year" && input.year) return input.year;
  if (input.precision === "estimated" && input.age != null && input.age >= 0) return today.getUTCFullYear() - Math.round(input.age);
  return null;
}
