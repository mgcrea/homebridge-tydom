import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json" with { type: "json" };
import fr from "../src/i18n/fr.json" with { type: "json" };
import { createTranslator } from "../src/i18n/index.js";

describe("createTranslator", () => {
  it("translates a known key in each locale", () => {
    expect(createTranslator("fr")("PREALARM")).toBe("Pré-alarme");
    expect(createTranslator("en")("PREALARM")).toBe("Pre-alarm");
  });

  it('falls back to "N/A" for an unknown key', () => {
    // The historical default, and what a user sees in the Home app when Delta
    // Dore ships a `nameStd` the tables predate.
    expect(createTranslator("en")("NOT_A_REAL_DELTA_DORE_KEY")).toBe("N/A");
  });

  it("uses an explicit fallback when given one", () => {
    expect(createTranslator("en")("NOT_A_REAL_DELTA_DORE_KEY", "Zone 3")).toBe("Zone 3");
  });

  it("does not resolve inherited object properties", () => {
    // Keys come off the wire, so a plain lookup must not walk the prototype.
    expect(createTranslator("en")("constructor")).toBe("N/A");
    expect(createTranslator("en")("toString")).toBe("N/A");
  });

  it("ships both tables in full", () => {
    // A truncated or empty table would not fail anything on its own — every
    // lookup would just quietly return the fallback — so assert the shape.
    expect(Object.keys(en).length).toBeGreaterThan(1000);
    expect(Object.keys(fr).length).toBeGreaterThan(1000);
  });

  it("covers every key the plugin looks up by name", () => {
    // The dynamic `nameStd` lookups cannot be checked, but these four are
    // literals in the accessory code and a missing one shows up as "N/A" on a
    // service in the Home app.
    for (const locale of ["en", "fr"] as const) {
      const t = createTranslator(locale);
      for (const key of [
        "ALARME_ISSUES_OUVERTES",
        "DISCRETE_ALARM_V3",
        "PREALARM",
        "HVAC_INFO_ABSENCE",
      ]) {
        expect(t(key), `${locale}.${key}`).not.toBe("N/A");
      }
    }
  });
});
