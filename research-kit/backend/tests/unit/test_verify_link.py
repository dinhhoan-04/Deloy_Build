import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"


def load_model(name: str):
    from app.models.page_model import PageModel

    return PageModel.model_validate(json.loads((FIXTURES / name).read_text()))


@pytest.mark.asyncio
async def test_verify_link_resolved():
    page_model = load_model("elicit_report.json")
    paper_data = {
        "title": "The impact of sleep deprivation",
        "abstract": "...",
        "source": "crossref",
    }
    with patch("app.tools.verify_link.fetch_paper", AsyncMock(return_value=paper_data)):
        from app.tools.verify_link import verify_link

        result = await verify_link("c1", page_model)
    assert result["status"] == "resolved"
    assert "fetched_url" in result


@pytest.mark.asyncio
async def test_verify_link_citation_not_found():
    from app.tools.verify_link import verify_link

    page_model = load_model("elicit_report.json")
    result = await verify_link("nonexistent", page_model)
    assert result["status"] == "not_found"


@pytest.mark.asyncio
async def test_verify_link_no_url():
    from app.models.page_model import PageModel, Citation, AdapterMeta
    from app.tools.verify_link import verify_link

    model = PageModel(
        site="elicit",
        schemaVersion="1.0",
        capturedAt="2026-05-05T00:00:00Z",
        url="https://elicit.com",
        title="Test",
        citations=[Citation(id="c1", label="[1]", rawAnchorText="Smith")],
        adapterMeta=AdapterMeta(
            adapterVersion="elicit/2026-05-05", extractionWarnings=[], selectorHits={}
        ),
    )
    result = await verify_link("c1", model)
    assert result["status"] == "no_url"
