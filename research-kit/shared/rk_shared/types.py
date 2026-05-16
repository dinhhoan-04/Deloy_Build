from enum import StrEnum

class RunKind(StrEnum):
    VERIFY   = "verify"
    EXTRACT  = "extract"
    CHAT     = "chat"
    DRAFT    = "draft"
    CONFLICT = "conflict"

class RunStatus(StrEnum):
    QUEUED     = "queued"
    RUNNING    = "running"
    CANCELLING = "cancelling"
    SUCCEEDED  = "succeeded"
    FAILED     = "failed"
    CANCELLED  = "cancelled"

TERMINAL_STATUSES = frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED})

class ClaimStatus(StrEnum):
    PENDING    = "pending"
    VERIFIED   = "verified"
    PARTIAL    = "partial"
    NOT_FOUND  = "not_found"
    ERROR      = "error"

class Site(StrEnum):
    ELICIT    = "elicit"
    SCISPACE  = "scispace"
    CONSENSUS = "consensus"

KIND_TIMEOUTS_SEC: dict[RunKind, int] = {
    RunKind.VERIFY:   150,  # 20s fetch + 30s GoClaw LLM + buffer
    RunKind.EXTRACT:  60,
    RunKind.CHAT:     60,
    RunKind.DRAFT:    180,
    RunKind.CONFLICT: 60,
}
