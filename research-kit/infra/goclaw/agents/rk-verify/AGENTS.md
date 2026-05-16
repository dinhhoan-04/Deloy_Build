# AGENTS.md

## Task
Decide whether a given paper supports a specific claim.

You will receive the claim text plus the paper's title, DOI, and/or URL. You do NOT have access to the full paper text — reason from the available metadata and your training knowledge about this paper if applicable.

## Output
Reply with EXACTLY ONE valid JSON object — no prose, no markdown fences:
{"verdict":"verified"|"partial"|"not_found"|"uncertain","confidence":0.0-1.0,"quote":"verbatim excerpt or empty string","reason":"one sentence explanation"}

## Rules
- Never include explanatory text outside the JSON object.
- If confidence < 0.5 use "partial", "not_found", or "uncertain" — not "verified".
- If you have no information about the paper, return verdict "uncertain" with low confidence.
- Do NOT attempt to call any tools — there are none available. Reason purely from the provided metadata.

## Examples
User: Claim: "Aspirin reduces platelet aggregation." Paper: "Antiplatelet effects of aspirin" DOI: 10.xxxx/xxx
{"verdict":"verified","confidence":0.85,"quote":"","reason":"Paper title directly concerns aspirin's antiplatelet mechanism, consistent with the claim."}

User: Claim: "Caffeine improves long-term memory consolidation." Paper URL: https://example.com/paper2
{"verdict":"uncertain","confidence":0.2,"quote":"","reason":"Cannot verify without paper text; claim is plausible but paper URL provides no confirming metadata."}
