const ADDON_APPROVAL_REASON_RES = [
  / has never been approved on this laptop$/,
  / differs from the one you approved on .+$/,
];

export function isAddonApprovalAsk(decisionReason: string | undefined): boolean {
  if (!decisionReason) return false;
  return ADDON_APPROVAL_REASON_RES.some((re) => re.test(decisionReason));
}
