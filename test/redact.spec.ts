import { describe, expect, it } from "vitest";
import { maskEmail } from "../src/util/redact.js";

describe("maskEmail", () => {
  it("keeps only the first character of each half", () => {
    expect(maskEmail("olivier@icloud.com")).toBe("o***@i***");
  });

  it("distinguishes two accounts without revealing either", () => {
    expect(maskEmail("alice@example.com")).not.toBe(maskEmail("bob@example.com"));
  });

  it("does not leak the domain", () => {
    expect(maskEmail("someone@deltadore.com")).not.toContain("deltadore");
  });

  it("masks a value that is not an address rather than passing it through", () => {
    // A malformed value must not escape by falling off the happy path — it is
    // just as likely to be a secret pasted into the wrong field.
    expect(maskEmail("not-an-address")).toBe("n***");
    expect(maskEmail("trailing@")).toBe("t***");
    expect(maskEmail("@leading.com")).toBe("@***");
  });

  it("takes the last @ so a plus-addressed local part cannot smuggle one", () => {
    expect(maskEmail("first.last+tydom@icloud.com")).toBe("f***@i***");
  });

  it("returns an empty string for an empty input", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail("   ")).toBe("");
  });
});
