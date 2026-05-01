import { join } from "node:path";

const _DOVEPAW_DIR = join(process.env.HOME!, ".dovepaw");
const _WORKSPACES_DIR = join(_DOVEPAW_DIR, "workspaces");

/** ~/.dovepaw/settings.groups/ — per-group settings directory */
export const GROUP_SETTINGS_DIR = join(_DOVEPAW_DIR, "settings.groups");
/** ~/.dovepaw/settings.groups/<groupName>/ — per-group config directory */
export const groupConfigDir = (groupName: string): string => join(GROUP_SETTINGS_DIR, groupName);
/** ~/.dovepaw/settings.groups/<groupName>/group.json — group config (repos + env vars) */
export const groupConfigFile = (groupName: string): string =>
  join(groupConfigDir(groupName), "group.json");
/** ~/.dovepaw/workspaces/group/ — shared group workspace root */
export const GROUP_WORKSPACE_ROOT = join(_WORKSPACES_DIR, "group");
