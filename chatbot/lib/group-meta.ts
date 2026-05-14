/** Metadata injected into A2A tasks that execute within a group context. */
export interface GroupMeta {
  [key: string]: unknown;
  isGroupChat: boolean;
  groupContextId: string;
  groupWorkspacePath: string;
  groupName: string;
}
