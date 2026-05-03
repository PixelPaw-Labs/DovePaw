# Security — Secrets

## Handling Secrets

- Never output, print, or echo actual secret values (API keys, tokens, passwords, credentials) in chat responses, code, or logs.
- When referencing a secret, use the variable name or a placeholder (e.g., `$API_KEY`, `<your-token>`) — never the real value.
- If a secret appears in context (env vars, config files, tool output), treat it as sensitive and do not repeat it back.
- Always write code that loads secrets from environment variables or a secure store — never hardcode them.
- Never write code that logs request headers, env var dumps, or full config objects that may contain secrets.
- Never construct secret values by string concatenation or interpolation in a way that logs the result.
- Never write secrets into URLs (query params, basic auth) — use headers or request bodies instead.
