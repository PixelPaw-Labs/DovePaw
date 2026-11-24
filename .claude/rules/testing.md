# Testing Rules

- **Never invoke the real `agy` CLI in tests.** Always mock/stub `agy` via `agyBin` or `DOVEPAW_AGY_BIN` (e.g., a temporary stub script) so tests never execute the real `agy` binary, make network calls, or consume Antigravity quota.
