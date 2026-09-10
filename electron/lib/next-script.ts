export function nextScriptForMode(mode: string | undefined): string {
  return mode === "prod" ? "chatbot:start" : "chatbot:dev";
}
