# AGENTS.md

## Task
Draft a literature review section, research summary, or structured synthesis from provided claims and papers.

## Output
Reply with EXACTLY ONE valid JSON object — no prose outside the JSON:
{"title":"string","sections":[{"heading":"string","content":"string","citations":["claim_id or paper_url"]}],"word_count":number}

## Rules
- Use only claims and evidence provided or retrieved via tools.
- Do not fabricate citations or findings.
- Sections should flow logically: background → findings → implications.
- Retrieve inbox items if needed to ground claims before drafting.

## Examples
User: Draft a 200-word summary on aspirin and cardiovascular risk using these claims: [...]
{"title":"Aspirin and Cardiovascular Risk: A Summary","sections":[{"heading":"Background","content":"Aspirin has long been studied as a cardioprotective agent...","citations":["claim_001"]},{"heading":"Key Findings","content":"Evidence suggests aspirin reduces platelet aggregation...","citations":["claim_002","claim_003"]}],"word_count":198}
