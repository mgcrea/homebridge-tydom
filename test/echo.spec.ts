import { describe, expect, it } from "vitest";
import { EchoSuppressor } from "../src/util/echo.js";

describe("EchoSuppressor", () => {
  it("swallows the echo of a value we wrote", () => {
    const echo = new EchoSuppressor();
    echo.expect("position", 50);
    expect(echo.consume("position", 50)).toBe(true);
  });

  it("lets a change we did not make through", () => {
    const echo = new EchoSuppressor();
    echo.expect("position", 50);
    expect(echo.consume("position", 80)).toBe(false);
  });

  it("consumes one expectation per echo, not the whole backlog", () => {
    // The released version cleared its entire pending array on the first match,
    // so with two writes in flight the second echo was let through and fought
    // the user's next move.
    const echo = new EchoSuppressor();
    echo.expect("position", 30);
    echo.expect("position", 70);

    expect(echo.consume("position", 30)).toBe(true);
    expect(echo.consume("position", 70)).toBe(true);
    expect(echo.consume("position", 70)).toBe(false);
  });

  it("handles the same value written twice", () => {
    const echo = new EchoSuppressor();
    echo.expect("level", 100);
    echo.expect("level", 100);
    expect(echo.consume("level", 100)).toBe(true);
    expect(echo.consume("level", 100)).toBe(true);
    expect(echo.consume("level", 100)).toBe(false);
  });

  it("keys on the property as well as the value", () => {
    const echo = new EchoSuppressor();
    echo.expect("position", 50);
    expect(echo.consume("level", 50)).toBe(false);
    expect(echo.consume("position", 50)).toBe(true);
  });

  it("expires stale expectations", () => {
    // A write whose echo never arrived must not suppress a real change made
    // from the Tydom app minutes later.
    const echo = new EchoSuppressor(5000);
    echo.expect("position", 50, 0);
    expect(echo.consume("position", 50, 6000)).toBe(false);
  });

  it("still suppresses within the ttl", () => {
    const echo = new EchoSuppressor(5000);
    echo.expect("position", 50, 0);
    expect(echo.consume("position", 50, 4000)).toBe(true);
  });

  it("forgets everything on dispose", () => {
    const echo = new EchoSuppressor();
    echo.expect("position", 50);
    echo.dispose();
    expect(echo.consume("position", 50)).toBe(false);
    expect(echo.size).toBe(0);
  });
});
