/**
 * Sessions explicitly deleted via the DELETE /api/chat handler (or bulk clear-all).
 * The POST /api/chat finally-block checks this set to skip re-saving a session
 * that was intentionally deleted mid-run — preventing rows from being re-created.
 */
export const deletedSessionIds = new Set<string>();
