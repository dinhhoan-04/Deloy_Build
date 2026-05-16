from typing import Literal, TypedDict

RunEventType = Literal["token","tool_call","tool_result","status","error","final","log"]

class RunEvent(TypedDict):
    type: RunEventType
    payload: dict
