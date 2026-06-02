// Deterministic re-normalisation of LLM output. When a value can't be parsed
// confidently we return null rather than guess — a wrong DOB is worse than none.

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Zero-pad a number to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Build ISO `YYYY-MM-DD` from a (y,m,d) triple, or null if not a real date. */
function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
    return null;
  }
  // Round-trip rejects impossible day-of-month (e.g. 31 Feb).
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parse a date of birth to ISO `YYYY-MM-DD`, or null if not unambiguous. */
export function normaliseDateOfBirth(input: string | null | undefined): string | null {
  if (input == null) {
    return null;
  }
  const raw = input.trim().toLowerCase();
  if (raw === "") {
    return null;
  }

  // 1. Already ISO (YYYY-MM-DD).
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // 2. Word-month forms ("2nd Jan 1990", "January 2 1990", "2nd of January 1990").
  //    Strip ordinals, commas, and "of" so they collapse to [day, month, year].
  const cleaned = raw
    .replace(/(\d+)(st|nd|rd|th)/g, "$1")
    .replace(/,/g, " ")
    .replace(/\bof\b/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 3) {
    const monthIdx = tokens.findIndex((t) => t in MONTHS);
    if (monthIdx !== -1) {
      const monthName = tokens[monthIdx];
      const month = monthName === undefined ? undefined : MONTHS[monthName];
      const nums = tokens
        .filter((_, i) => i !== monthIdx)
        .map(Number)
        .filter(Number.isInteger);
      if (month !== undefined && nums.length === 2) {
        const year = nums.find((n) => n > 31); // the 4-digit value is the year
        const day = nums.find((n) => n <= 31);
        if (year !== undefined && day !== undefined) {
          return toIso(year, month, day);
        }
      }
    }
  }

  // 3. All-numeric, UK day-first (DD/MM/YYYY).
  const numeric = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (numeric) {
    return toIso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }

  return null;
}

/** Trim, drop empties, and case-insensitively de-dupe (keeping first-seen casing). */
export function normaliseSymptoms(symptoms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symptom of symptoms) {
    const trimmed = symptom.trim();
    if (trimmed === "") {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** Trim a duration string; blank/empty → null. */
export function normaliseDuration(duration: string | null | undefined): string | null {
  const trimmed = duration?.trim();
  return trimmed ? trimmed : null;
}

/** Collapse internal whitespace in a name; blank/empty → null. */
export function normaliseName(name: string | null | undefined): string | null {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}
