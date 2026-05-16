import json
import pytest
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures" / "page_models"

def test_page_model_imports():
    from app.models.page_model import PageModel  # noqa

def test_elicit_report_fixture_parses():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    m = PageModel.model_validate(data)
    assert m.site == "elicit"
    assert m.answer is not None
    assert len(m.citations) > 0
    assert m.tableRows is None

def test_elicit_table_fixture_parses():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_table.json").read_text())
    m = PageModel.model_validate(data)
    assert m.site == "elicit"
    assert m.tableRows is not None
    assert m.answer is None

def test_selection_ref_is_optional():
    from app.models.page_model import PageModel
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    m = PageModel.model_validate(data)
    assert m.selection is None

def test_agent_run_request_parses():
    from app.models.request import AgentRunRequest
    from app.models.page_model import PageModel
    import json
    data = json.loads((FIXTURES / "elicit_report.json").read_text())
    req = AgentRunRequest(
        request="Summarize the findings",
        page_models=[PageModel.model_validate(data)],
        mode="chat",
    )
    assert req.mode == "chat"
    assert len(req.page_models) == 1
