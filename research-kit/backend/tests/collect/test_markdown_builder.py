from app.schemas import MergedClaim, CollectCitation
from app.services.collect.markdown_builder import build_doc_markdown


def _claim(text, score=None):
    return MergedClaim(
        claim_text=text,
        citations=[CollectCitation(ref_id="1", url="https://doi.org/A")],
        source_tools=["elicit"],
        verify_score=score,
    )


def test_build_doc_markdown_includes_topic_heading():
    md = build_doc_markdown(
        topic="Sleep",
        date="2026-04-30",
        tools_used=["elicit"],
        run_verify=False,
        summary="Sleep is important.",
        claims=[_claim("Sleep helps memory.", None)],
        references=[],
        raw_by_tool={},
    )
    assert "# Research Session: Sleep" in md
    assert "**Date:** 2026-04-30" in md


def test_build_doc_markdown_groups_by_verify_score():
    md = build_doc_markdown(
        topic="x",
        date="d",
        tools_used=["elicit"],
        run_verify=True,
        summary="S.",
        claims=[_claim("hi", 90), _claim("med", 70), _claim("low", 20)],
        references=[],
        raw_by_tool={},
    )
    hi, med, lo = (
        md.index("High-confidence"),
        md.index("Medium-confidence"),
        md.index("Low-confidence"),
    )
    assert hi < med < lo


def test_build_doc_markdown_includes_verify_sections():
    md = build_doc_markdown(
        topic="x",
        date="d",
        tools_used=["elicit"],
        run_verify=True,
        summary="S.",
        claims=[_claim("hi", 90), _claim("med", 60), _claim("low", 20)],
        references=[],
        raw_by_tool={},
    )
    assert "## High-confidence findings (score ≥ 80)" in md
    assert "## Medium-confidence findings (score 50-79)" in md
    assert "## Low-confidence findings (score < 50)" in md
    assert "## Unverifiable claims" in md
    hi = md.index("High-confidence")
    med = md.index("Medium-confidence")
    lo = md.index("Low-confidence")
    assert hi < med < lo


def test_omits_verify_sections_when_run_verify_false():
    md = build_doc_markdown(
        topic="x",
        date="d",
        tools_used=["elicit"],
        run_verify=False,
        summary="S.",
        claims=[_claim("a", None)],
        references=[],
        raw_by_tool={},
    )
    assert "High-confidence" not in md
    assert "## All claims" in md
