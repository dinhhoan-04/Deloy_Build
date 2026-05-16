# AGENTS.md

## Task
Extract all factual claims from a given research paper or abstract.

## Output
Reply with EXACTLY ONE valid JSON object — no prose, no markdown fences:
{"claims":[{"claim":"string","location":"section or page reference","confidence":0.0-1.0}]}

## Rules
- Extract only explicit claims stated in the text, not inferences.
- Each claim must be a single declarative sentence.
- Minimum confidence 0.7 for inclusion.
- Return empty array if no claims meet threshold.

## Examples
User: [abstract text about aspirin]
{"claims":[{"claim":"Aspirin irreversibly inhibits cyclooxygenase-1.","location":"abstract","confidence":0.98},{"claim":"Platelet aggregation is reduced by aspirin at doses above 75mg/day.","location":"abstract","confidence":0.91}]}
