import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


@pytest.mark.asyncio
async def test_chat_injects_context_into_system_prompt():
    """When run input contains 'context', it must appear in the system prompt sent to provider."""
    captured_system = {}

    async def fake_extract(system, user, schema):
        captured_system['value'] = system
        return {"text": "answer"}

    from app.routers.runs import _execute_inline_run
    from rk_shared.types import RunKind
    import json

    run_id = uuid4()
    run = MagicMock()
    run.id = run_id
    run.kind = RunKind.CHAT.value
    run.input = {
        "messages": [{"role": "user", "content": "hello"}],
        "context": "Relevant content:\n\n[Page from https://example.com]\nsome page text",
    }
    run.user_id = uuid4()

    mock_result = MagicMock()
    mock_result.scalar_one.return_value = run

    mock_session = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.execute = AsyncMock(return_value=mock_result)

    mock_provider = MagicMock()
    mock_provider.extract = AsyncMock(side_effect=fake_extract)

    with patch('app.routers.runs._provider_chain', return_value=mock_provider):
        await _execute_inline_run(lambda: mock_session, run_id)

    assert 'relevant content' in captured_system['value'].lower() or 'context' in captured_system['value'].lower()
    assert 'some page text' in captured_system['value']
