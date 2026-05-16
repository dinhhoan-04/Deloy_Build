import logging
import structlog
from contextvars import ContextVar

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)


def _add_ctx(_, __, event_dict):
    rid = request_id_ctx.get()
    uid = user_id_ctx.get()
    if rid:
        event_dict["request_id"] = rid
    if uid:
        event_dict["user_id"] = uid
    return event_dict


def configure(level: str = "INFO") -> None:
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            _add_ctx,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        logger_factory=structlog.PrintLoggerFactory(),
    )


def get_logger(name: str = "app") -> structlog.BoundLogger:
    return structlog.get_logger(name)
