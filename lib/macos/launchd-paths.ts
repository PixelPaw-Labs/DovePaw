import { join } from "node:path";

/** ~/Library/LaunchAgents — macOS launchd user agents directory */
export const LAUNCH_AGENTS_DIR = join(process.env.HOME!, "Library/LaunchAgents");
/** ~/Library/LaunchAgents/<label>.plist */
export const plistFilePath = (label: string) => join(LAUNCH_AGENTS_DIR, `${label}.plist`);
