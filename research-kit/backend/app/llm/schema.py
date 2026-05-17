"""JSON schema for structured extraction output.

Used for BOTH Gemini `responseSchema` and OpenAI `response_format=json_schema`
(strict mode). Keep flat and explicit — provider strict-mode parsers reject
exotic constructs.
"""

EXTRACT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["papers", "claims"],
    "properties": {
        "papers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "title", "doi", "url", "authors", "year", "anchorText"],
                "properties": {
                    "id": {"type": "string", "description": "Local sequential id like p1, p2, ..."},
                    "title": {"type": "string"},
                    "doi": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "url": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "authors": {"type": "array", "items": {"type": "string"}},
                    "year": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "anchorText": {
                        "type": "string",
                        "description": "Marker as it appears on page, e.g. [1], (Smith 2023)",
                    },
                },
            },
        },
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "text", "paperIds"],
                "properties": {
                    "id": {"type": "string", "description": "Local sequential id like c1, c2, ..."},
                    "text": {"type": "string"},
                    "paperIds": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
}
