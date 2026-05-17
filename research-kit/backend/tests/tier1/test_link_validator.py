import pytest
from unittest.mock import AsyncMock, patch
from app.services.tier1.link_validator import validate_link

ARXIV_URL = "https://arxiv.org/abs/1810.04805"
BLOG_URL = "https://medium.com/some-article"
DEAD_URL = "https://example.com/dead-link"


@pytest.mark.asyncio
async def test_trusted_resolvable_http_ok_scores_100():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=True),
    ):
        result = await validate_link(ref_id="1", url=ARXIV_URL)
    assert result.score == 100
    assert result.status == "ok"
    assert result.components.http_ok is True


@pytest.mark.asyncio
async def test_http_ok_only_scores_50():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=False),
    ):
        result = await validate_link(ref_id="1", url=BLOG_URL)
    assert result.score == 50
    assert result.status == "ok"


@pytest.mark.asyncio
async def test_http_fail_scores_zero():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=False),
    ):
        result = await validate_link(ref_id="1", url=DEAD_URL)
    assert result.score == 0
    assert result.status == "not_found"


@pytest.mark.asyncio
async def test_trusted_domain_only_scores_20():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=True),
    ):
        result = await validate_link(ref_id="1", url=ARXIV_URL)
    assert result.score == 20


@pytest.mark.asyncio
async def test_http_resolvable_no_trusted_scores_80():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=False),
    ):
        result = await validate_link(ref_id="1", url=BLOG_URL)
    assert result.score == 80


@pytest.mark.asyncio
async def test_timeout_scores_zero_status_timeout():
    with (
        patch(
            "app.services.tier1.link_validator._check_http",
            new_callable=AsyncMock,
            side_effect=TimeoutError,
        ),
        patch(
            "app.services.tier1.link_validator._check_resolvable",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch("app.services.tier1.link_validator._check_trusted_domain", return_value=False),
    ):
        result = await validate_link(ref_id="1", url=DEAD_URL)
    assert result.score == 0
    assert result.status == "timeout"


def test_arxiv_is_trusted_domain():
    from app.services.tier1.link_validator import _check_trusted_domain

    assert _check_trusted_domain("https://arxiv.org/abs/123") is True
    assert _check_trusted_domain("https://medium.com/post") is False
    assert _check_trusted_domain("https://cs.mit.edu/paper") is True
    assert _check_trusted_domain("https://data.gov/dataset") is True
