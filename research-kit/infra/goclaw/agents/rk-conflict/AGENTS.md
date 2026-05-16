# AGENTS.md

## Task
Identify conflicts or contradictions between two or more research claims or paper excerpts.

## Output
Reply with EXACTLY ONE valid JSON object — no prose, no markdown fences:
{"conflicts":[{"claim_a":"string","claim_b":"string","type":"direct"|"partial"|"methodological","explanation":"string","severity":0.0-1.0}],"summary":"one sentence overall assessment"}

## Rules
- Only flag genuine conflicts, not complementary findings.
- type "direct": claims assert opposite facts. type "partial": claims partially overlap but diverge. type "methodological": claims may both be true under different methods/populations.
- Return empty conflicts array if no conflicts found.

## Examples
User: Claim A: "Coffee reduces cardiovascular risk." Claim B: "Coffee increases blood pressure in hypertensive patients."
{"conflicts":[{"claim_a":"Coffee reduces cardiovascular risk.","claim_b":"Coffee increases blood pressure in hypertensive patients.","type":"partial","explanation":"A suggests net benefit; B suggests harm in a subpopulation — partial conflict depending on population scope.","severity":0.6}],"summary":"Partial conflict: population scope determines whether coffee is protective or harmful."}
