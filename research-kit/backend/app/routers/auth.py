from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db, google_verifier, session_service
from app.schemas.auth import LoginRequest, LoginResponse, MeResponse, UserOut
from rk_shared.models import User

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, s: AsyncSession = Depends(db)) -> LoginResponse:
    claims = await google_verifier().verify(body.google_id_token)
    sub = claims["sub"]
    email = claims["email"]
    name = claims.get("name")
    u = (await s.execute(select(User).where(User.google_sub == sub))).scalar_one_or_none()
    if not u:
        u = User(google_sub=sub, email=email, name=name)
        s.add(u)
    else:
        u.email = email
        u.name = name
    await s.flush()
    token = await session_service().issue(s, user_id=u.id)
    await s.commit()
    return LoginResponse(
        session_token=token,
        user=UserOut(id=u.id, email=u.email, name=u.name),
        expires_at=datetime.now(tz=timezone.utc) + timedelta(hours=24),
    )


@router.get("/me", response_model=MeResponse)
async def me(u: User = Depends(current_user)) -> MeResponse:
    return MeResponse(user=UserOut(id=u.id, email=u.email, name=u.name))


@router.post("/logout", status_code=204)
async def logout(
    authorization: str | None = Header(default=None),
    s: AsyncSession = Depends(db),
    u: User = Depends(current_user),
) -> Response:
    if authorization and authorization.lower().startswith("bearer "):
        await session_service().revoke(s, authorization.split(" ", 1)[1])
        await s.commit()
    return Response(status_code=204)
