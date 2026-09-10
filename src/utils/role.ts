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

/** A scoped owner — full control, but only inside `member.managedClientIds`. */
export function isManagerRole(role: string | undefined | null): boolean {
  return (role || '').trim().toLowerCase() === 'manager'
}

/** Sees an admin area at all (Team / All Assignments) — owner or manager. */
export function isAdminRole(role: string | undefined | null): boolean {
  return isOwnerRole(role) || isManagerRole(role)
}

/**
 * Can this member act as an owner for the given client — create projects,
 * create/assign/delete tasks, edit tasks freely? True for the owner
 * (any client) and for a manager whose scope includes `clientId`.
 * Mirrors `canManageClient()` in firestore.rules.
 */
export function canManageClient(
  member: { role?: string; managedClientIds?: string[] } | null | undefined,
  clientId: string | undefined | null
): boolean {
  if (!member) return false
  if (isOwnerRole(member.role)) return true
  return isManagerRole(member.role) && !!clientId && (member.managedClientIds ?? []).includes(clientId)
}
