/** Bank account numbers are typed twice (first masked) so a typo cannot slip into salary payments. */
export const normalizeAccount = (v: string) => v.replace(/\s+/g, "");

/** Null when the two entries agree (or nothing was typed); otherwise the message to show. */
export function accountConfirmError(account: string, confirm: string): string | null {
  const a = normalizeAccount(account), c = normalizeAccount(confirm);
  if (!a && !c) return null;
  if (!c) return "Re-enter the account number to confirm it.";
  if (a !== c) return "The two account numbers do not match. Check both and type them again.";
  return null;
}
