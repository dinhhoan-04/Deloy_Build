from app.schemas import SentenceResult, LinkResult, LinkComponents
from app.services.tier3.paragraph_scorer import score_paragraph, score_document


def _make_sentence(score: float | None, status: str = "verified", has_citation: bool = True) -> SentenceResult:
    return SentenceResult(
        text="A sentence.",
        score=score,
        citation_ref="1" if has_citation else None,
        status=status,
    )


def _make_link(score: int = 100) -> LinkResult:
    return LinkResult(
        ref_id="1", url="https://arxiv.org/abs/123", score=score,
        components=LinkComponents(http_ok=True, resolvable=True, trusted_domain=True),
        status="ok",
    )


def test_paragraph_all_verified_high_density():
    sentences = [_make_sentence(80), _make_sentence(90), _make_sentence(100)]
    result = score_paragraph(sentences, [_make_link()])
    assert result.citation_density == 100.0
    assert result.paragraph_score is not None
    # 0.3*100 + 0.7*mean([80,90,100]) = 30 + 63 = 93
    assert abs(result.paragraph_score - 93.0) < 0.5


def test_paragraph_no_citations_scores_zero():
    sentences = [_make_sentence(None, "na_no_citation", has_citation=False)] * 3
    result = score_paragraph(sentences, [])
    assert result.citation_density == 0.0
    assert result.paragraph_score is None


def test_paragraph_mixed_status_excludes_unverified():
    sentences = [
        _make_sentence(80, "verified"),
        _make_sentence(None, "na_paper_inaccessible", has_citation=False),
        _make_sentence(60, "verified"),
    ]
    result = score_paragraph(sentences, [_make_link()])
    # density: 2 cited out of 3 = 66.7%
    # avg score: mean([80, 60]) = 70
    # 0.3*66.7 + 0.7*70 = 20.0 + 49.0 = 69.0
    assert result.paragraph_score is not None
    assert abs(result.paragraph_score - 69.0) < 1.0


def test_document_score_averages_paragraphs():
    from app.schemas import ParagraphResult
    p1 = ParagraphResult(paragraph_score=80, citation_density=100, sentences=[], links=[])
    p2 = ParagraphResult(paragraph_score=60, citation_density=100, sentences=[], links=[])
    doc_score = score_document([p1, p2])
    assert doc_score == 70.0


def test_document_score_ignores_none_paragraphs():
    from app.schemas import ParagraphResult
    p1 = ParagraphResult(paragraph_score=80, citation_density=100, sentences=[], links=[])
    p2 = ParagraphResult(paragraph_score=None, citation_density=0, sentences=[], links=[])
    doc_score = score_document([p1, p2])
    assert doc_score == 80.0
