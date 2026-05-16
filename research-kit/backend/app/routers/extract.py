from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.llm import ExtractFailed, extract_via_llm
from app.schemas.extract import (
    ClaimOut,
    ExtractMeta,
    ExtractRequest,
    ExtractResponse,
    PaperOut,
)

# No session auth — called by the Chrome extension content script which has no
# cookie context. Quota protection must be handled at the infra/rate-limit layer.
router = APIRouter(prefix="/v1", tags=["extract"])


@router.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest) -> ExtractResponse:
    try:
        result = await extract_via_llm(
            markdown=req.page_markdown,
            site=req.site,
            url=req.url,
        )
    except ExtractFailed as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "extract_unavailable", "message": str(e)},
        )
    try:
        return ExtractResponse(
            papers=[PaperOut(**p) for p in result.papers],
            claims=[ClaimOut(**c) for c in result.claims],
            extractMeta=ExtractMeta(**result.meta),
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "extract_malformed", "message": str(e)},
        )
