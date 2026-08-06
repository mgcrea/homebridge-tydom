/**
 * Mask an e-mail address for logging.
 *
 * `olivier@icloud.com` becomes `o***@i***`: enough to tell two accounts apart in
 * a support thread, not enough to be worth harvesting from a pasted log. The
 * config schema promises the password and PIN are never logged, and an account
 * e-mail is the other half of a credential pair — it does not belong in a log a
 * user is about to paste into a GitHub issue.
 *
 * Anything that is not recognisably an address is masked wholesale rather than
 * passed through, so a malformed value cannot leak by falling off the happy
 * path.
 */
export const maskEmail = (email: string): string => {
  const trimmed = email.trim();
  if (!trimmed) {
    return "";
  }
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return `${trimmed.slice(0, 1)}***`;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
};
