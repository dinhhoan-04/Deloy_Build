from app.schemas import ToolCapture, RawClaim, CollectCitation
from app.services.collect.aggregator import merge_claims, dedupe_references, normalise_url


def _cap(tool, claim_text, refs):
    return ToolCapture(
        tool_name=tool, captured_at="2026-04-30T10:00:00Z", raw_text="",
        claims=[RawClaim(text=claim_text, citations=[CollectCitation(**r) for r in refs])],
    )


def test_normalise_url_strips_query_and_trailing_slash():
    assert normalise_url("https://doi.org/10.1/X/?utm=1") == "https://doi.org/10.1/x"


def test_dedupe_references_by_normalised_url():
    caps = [
        _cap("elicit", "c1", [{"ref_id": "1", "url": "https://doi.org/10.1/A"}]),
        _cap("chatgpt", "c2", [{"ref_id": "1", "url": "https://doi.org/10.1/A?x=1"}]),
    ]
    refs = dedupe_references(caps)
    assert len(refs) == 1
    assert refs[0]["paper_url"] == "https://doi.org/10.1/a"


def test_merge_claims_groups_identical_text_across_tools():
    caps = [
        _cap("elicit", "Sleep helps memory.", [{"ref_id": "1", "url": "https://doi.org/A"}]),
        _cap("chatgpt", "sleep helps memory.", [{"ref_id": "2", "url": "https://doi.org/A"}]),
    ]
    merged = merge_claims(caps)
    assert len(merged) == 1
    assert set(merged[0].source_tools) == {"elicit", "chatgpt"}
    assert len(merged[0].citations) == 1


def test_merge_claims_preserves_distinct_claims():
    caps = [
        _cap("elicit", "A.", [{"ref_id": "1", "url": "u1"}]),
        _cap("perplexity", "B.", [{"ref_id": "2", "url": "u2"}]),
    ]
    merged = merge_claims(caps)
    assert len(merged) == 2
