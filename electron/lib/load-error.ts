// -3 = ERR_ABORTED, emitted when the user navigates away mid-load. Not a real error.
const ERR_ABORTED = -3;

export function computeLoadFailureMessage(
  errorCode: number,
  errorDescription: string,
  isMainFrame: boolean,
): string | null {
  if (!isMainFrame || errorCode === ERR_ABORTED) return null;
  return errorDescription || `Failed to load (code ${errorCode})`;
}
