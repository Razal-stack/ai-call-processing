import { describe, expect, it } from "vitest";
import {
  normaliseDateOfBirth,
  normaliseDuration,
  normaliseName,
  normaliseSymptoms,
} from "../../src/services/normalise.js";

describe("normaliseDateOfBirth", () => {
  it("passes through valid ISO dates", () => {
    expect(normaliseDateOfBirth("1990-01-02")).toBe("1990-01-02");
  });

  it("parses the brief's example: '2nd Jan 1990' → 1990-01-02", () => {
    expect(normaliseDateOfBirth("2nd Jan 1990")).toBe("1990-01-02");
  });

  it.each([
    ["2 January 1990", "1990-01-02"],
    ["January 2 1990", "1990-01-02"],
    ["Jan 2nd, 1990", "1990-01-02"],
    ["2nd of January 1990", "1990-01-02"], // 'of' is dropped → 3 tokens
    ["15 March 1985", "1985-03-15"],
    ["3rd December 2001", "2001-12-03"],
  ])("parses word-month form %s → %s", (input, expected) => {
    expect(normaliseDateOfBirth(input)).toBe(expected);
  });

  it("parses UK day-first numeric dates (documented locale assumption)", () => {
    expect(normaliseDateOfBirth("02/01/1990")).toBe("1990-01-02");
    expect(normaliseDateOfBirth("15-03-1985")).toBe("1985-03-15");
    expect(normaliseDateOfBirth("2.1.1990")).toBe("1990-01-02");
  });

  it("returns null for missing or empty input", () => {
    expect(normaliseDateOfBirth(null)).toBeNull();
    expect(normaliseDateOfBirth(undefined)).toBeNull();
    expect(normaliseDateOfBirth("   ")).toBeNull();
  });

  it("returns null for impossible calendar dates", () => {
    expect(normaliseDateOfBirth("1990-02-31")).toBeNull();
    expect(normaliseDateOfBirth("31 February 1990")).toBeNull();
    expect(normaliseDateOfBirth("32/01/1990")).toBeNull();
  });

  it("returns null for ambiguous / partial / unparseable input", () => {
    expect(normaliseDateOfBirth("Jan 1990")).toBeNull(); // no day
    expect(normaliseDateOfBirth("sometime in the 90s")).toBeNull();
    expect(normaliseDateOfBirth("1990")).toBeNull();
  });

  it("rejects implausible years", () => {
    expect(normaliseDateOfBirth("02/01/1850")).toBeNull();
  });
});

describe("normaliseSymptoms", () => {
  it("trims, drops empties, and de-duplicates case-insensitively", () => {
    expect(normaliseSymptoms(["  Cough ", "cough", "", "Fever", "FEVER"])).toEqual([
      "Cough",
      "Fever",
    ]);
  });

  it("preserves first-seen order and casing", () => {
    expect(normaliseSymptoms(["Sore throat", "headache"])).toEqual(["Sore throat", "headache"]);
  });

  it("returns an empty array for no symptoms", () => {
    expect(normaliseSymptoms([])).toEqual([]);
  });
});

describe("normaliseDuration / normaliseName", () => {
  it("collapses blank duration to null and trims otherwise", () => {
    expect(normaliseDuration("  5 days ")).toBe("5 days");
    expect(normaliseDuration("   ")).toBeNull();
    expect(normaliseDuration(null)).toBeNull();
  });

  it("collapses internal whitespace in names and blanks to null", () => {
    expect(normaliseName("  John   Smith ")).toBe("John Smith");
    expect(normaliseName("")).toBeNull();
    expect(normaliseName(null)).toBeNull();
  });
});
