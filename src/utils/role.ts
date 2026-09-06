/**
 * Firestore `role` values are hand-typed by the owner in the console at
 * least once (the one-time owner bootstrap — see firestore.rules) with
 * no validation. A stray capital letter or trailing space there made
 * `isOwner()` silently fail everywhere, including in the security rules
 * themselves (real access denials, not just a UI glitch) — so every
 * comparison, client and rules side, tolerates case/whitespace now.
 */
export function isOwnerRole(role: string | undefined | null): boolean {
  return (role || '').trim().toLowerCase() === 'owner'
}
