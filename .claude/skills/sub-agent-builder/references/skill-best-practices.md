# Skill Best Practices

Full reference: https://agentskills.io/skill-creation/best-practices.md

---

## Key principles

**Only add what the agent lacks.** Omit anything the agent already knows. Each instruction should answer "would the agent get this wrong without it?"

**Under 500 lines / 5,000 tokens.** Move detailed reference material to `references/` and tell the agent _when_ to load it (`"Read references/api-errors.md if the API returns non-200"`).

**Gotchas section.** Highest-value content: environment-specific facts that defy reasonable assumptions. Not general advice — concrete corrections to mistakes the agent will make without being told. Add to this section every time you correct the agent.

**Defaults, not menus.** Pick one approach and mention alternatives briefly. Never present equal options without a recommended default.

**Match specificity to fragility.** Give the agent freedom when variation is tolerated. Be prescriptive when the operation is fragile or a specific sequence must be followed.

**Procedures over declarations.** Teach how to approach a class of problems, not the answer to a specific instance.

**Templates for structured output.** Provide a concrete template when the agent must produce a specific format — pattern-matching beats prose descriptions.

**Checklists for multi-step workflows.** Use `- [ ]` checklists when steps have dependencies or validation gates.

**Validation loops.** Instruct the agent to run a validator, fix failures, and repeat until passing before moving on.

**Plan-validate-execute for batch/destructive ops.** Agent creates an intermediate plan → validates against source of truth → executes only on success.
