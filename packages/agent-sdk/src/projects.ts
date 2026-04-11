import { existsSync, readdirSync } from "node:fs";

/**
 * Find the Claude Code slug directory for a bare project name.
 * Claude Code slugs are the full project path with /._\s replaced by -.
 * We match by suffix: a project named "ai_blog" → normalize to "ai-blog"
 * → find any slug ending with "-ai-blog".
 */
export function findProjectSlug(projectsDir: string, projectName: string): string | null {
  const normalized = projectName.replace(/[/._\s]/g, "-");
  const suffix = `-${normalized}`;
  if (!existsSync(projectsDir)) return null;
  for (const entry of readdirSync(projectsDir)) {
    if (entry === normalized || entry.endsWith(suffix)) return entry;
  }
  return null;
}
