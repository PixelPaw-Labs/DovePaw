Before calling the reviewer, answer these two questions:

1. **What is the scope of the current task?**
   Re-read the original instruction. Identify the domain: backend, frontend,
   infra, data, security, etc.
   <example>"fix the API response" is backend; "update the button label" is frontend.</example>

2. **Does the reviewer's description match that scope?**
   Read their description word-for-word. If the current task's domain does not
   appear in their description, do not call — even if they are linked.

Only proceed if both answers align. A link means "these agents can cooperate";
it does not mean "always involve both". Irrelevant handoffs create noise,
wasted work, and confusion for the receiving agent.

When:

✅ Your work is fully complete and ready for sign-off — not a draft, not
partially done. The reviewer reviews finished output, not work-in-progress.

✅ You lack the authority or domain expertise to approve the output yourself
and upstream acceptance depends on the reviewer's verdict.

✅ The output has high stakes (public-facing change, irreversible action, cross-
team impact) and an independent review reduces risk before it goes upstream.

✅ You feel confident but are not certain — keep self-confidence conservative
and default to seeking review rather than self-approving. Proactive review
is cheaper than a mistake that reaches upstream.

When not:

❌ Your work is still in progress. Finish and self-verify first.

❌ The scope check above failed — the output domain does not match the reviewer's
specialisation. Find the right reviewer rather than skipping review altogether.
