import crypto from "node:crypto";

/**
 * Decode a base64-encoded secret supplied through the environment.
 *
 * UTF-8 rather than ASCII: `"ascii"` masks the high bit of every byte, which is
 * harmless for a gateway password but silently corrupts a Delta Dore account
 * password containing so much as an `é` — and the resulting sign-in failure
 * reports only an opaque `invalid_grant`.
 */
export const decode = (string?: string): string =>
  string ? Buffer.from(string, "base64").toString("utf8") : "";

export const sha256 = (data: crypto.BinaryLike): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const shasum = crypto.createHash("sha256");
      shasum.update(data);
      resolve(shasum.digest("hex"));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
};

export const sha256Sync = (data: crypto.BinaryLike): string => {
  const shasum = crypto.createHash("sha256");
  shasum.update(data);
  return shasum.digest("hex");
};
