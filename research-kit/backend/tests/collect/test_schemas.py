from app.schemas import CollectRequest, CollectResponse, ToolCapture, RawClaim, CollectCitation


def test_collect_request_defaults_to_markdown_format():
    req = CollectRequest(
        user_id="u1",
        tools=[
            ToolCapture(
                tool_name="elicit",
                captured_at="2026-04-30T10:00:00Z",
                raw_text="hello",
                claims=[
                    RawClaim(
                        text="Sleep helps memory.",
                        citations=[CollectCitation(ref_id="1", url="https://doi.org/x")],
                    )
                ],
            )
        ],
    )
    assert req.output_format == "markdown"
    assert req.run_verify is False


def test_collect_request_accepts_docx_and_gdocs():
    for fmt in ("markdown", "docx", "gdocs"):
        req = CollectRequest(
            user_id="u",
            output_format=fmt,
            tools=[ToolCapture(tool_name="elicit", captured_at="t", raw_text="r", claims=[])],
        )
        assert req.output_format == fmt


def test_collect_response_requires_markdown_field():
    resp = CollectResponse(
        session_id="abc-123",
        topic="Sleep",
        summary="x",
        markdown="# Sleep\n\nSummary.",
        docx_base64=None,
        google_doc_url=None,
        n_claims=0,
        n_high_confidence=0,
        n_low_confidence=0,
        output_format_used="markdown",
    )
    assert resp.markdown.startswith("# Sleep")
    assert resp.output_format_used == "markdown"
