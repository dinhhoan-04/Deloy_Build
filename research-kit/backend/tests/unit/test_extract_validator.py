from app.llm.validator import validate_correspondence


def test_passthrough_when_valid():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": "[1]"}],
        "claims": [{"id": "c1", "text": "claim text", "paperIds": ["p1"]}],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert cleaned["papers"] == raw["papers"]
    assert cleaned["claims"] == raw["claims"]
    assert warnings == []


def test_drops_claim_with_orphan_paper_id():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [
            {"id": "c1", "text": "ok", "paperIds": ["p1"]},
            {"id": "c2", "text": "orphan", "paperIds": ["p99"]},
        ],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert [c["id"] for c in cleaned["claims"]] == ["c1"]
    assert any("c2" in w and "p99" in w for w in warnings)


def test_drops_claim_when_some_paper_ids_orphan():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "mixed", "paperIds": ["p1", "p99"]}],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert cleaned["claims"] == []
    assert any("c1" in w and "p99" in w for w in warnings)


def test_merges_duplicate_titles():
    raw = {
        "papers": [
            {"id": "p1", "title": "Same Title", "doi": "10.1/a", "url": None, "authors": [], "year": None, "anchorText": "[1]"},
            {"id": "p2", "title": "Same Title", "doi": None, "url": "http://x", "authors": [], "year": None, "anchorText": "[2]"},
        ],
        "claims": [
            {"id": "c1", "text": "first", "paperIds": ["p1"]},
            {"id": "c2", "text": "second", "paperIds": ["p2"]},
        ],
    }
    cleaned, warnings = validate_correspondence(raw)
    assert len(cleaned["papers"]) == 1
    assert cleaned["papers"][0]["id"] == "p1"
    # both claims now reference p1
    assert all("p1" in c["paperIds"] for c in cleaned["claims"])
    assert any("merged" in w.lower() for w in warnings)


def test_handles_empty_input():
    cleaned, warnings = validate_correspondence({"papers": [], "claims": []})
    assert cleaned == {"papers": [], "claims": []}
    assert warnings == []


def test_dedup_within_single_claim_paper_ids():
    raw = {
        "papers": [{"id": "p1", "title": "A", "doi": None, "url": None, "authors": [], "year": None, "anchorText": ""}],
        "claims": [{"id": "c1", "text": "x", "paperIds": ["p1", "p1"]}],
    }
    cleaned, _ = validate_correspondence(raw)
    assert cleaned["claims"][0]["paperIds"] == ["p1"]
