const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isExternalLink(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && EXTERNAL_PROTOCOLS.has(parsed.protocol);
}

export function leavesApp(url: string, appUrl: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.origin !== new URL(appUrl).origin;
}
