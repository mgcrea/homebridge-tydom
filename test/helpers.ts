import type { PluginLogger } from "../src/api/client.js";
import type { TydomMetaElement } from "../src/api/types.js";

/** A logger that records instead of printing, so tests can assert on output. */
export const createTestLogger = (): PluginLogger & { messages: string[] } => {
  const messages: string[] = [];
  return {
    messages,
    debug: (m) => messages.push(`debug: ${m}`),
    info: (m) => messages.push(`info: ${m}`),
    warn: (m) => messages.push(`warn: ${m}`),
    error: (m) => messages.push(`error: ${m}`),
  };
};

/**
 * Build endpoint metadata from property names.
 *
 * Only `name` feeds the signature, plus `level.step` for dimmability, so the
 * other attributes are filled with plausible defaults.
 */
export const metadataFrom = (names: string[], levelStep?: number): TydomMetaElement[] =>
  names.map((name) => ({
    name,
    permission: "r" as const,
    type: "string" as const,
    ...(name === "level" && levelStep !== undefined ? { step: levelStep } : {}),
  }));
