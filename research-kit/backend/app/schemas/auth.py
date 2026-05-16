from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class LoginRequest(BaseModel):
    google_id_token: str


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str | None = None


class LoginResponse(BaseModel):
    session_token: str
    user: UserOut
    expires_at: datetime


class MeResponse(BaseModel):
    user: UserOut
