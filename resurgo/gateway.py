"""Model gateway client, wrapped as a minimal LangChain chat model so the neatlogs handler
records every call as an LLM span with prompt and response.

POST {MODEL_GATEWAY_URL}/v1/completions {"system","user"} -> {"model","effort","text"}.
The gateway reports no token counts, so usage is estimated (characters / 4) and labelled so.
"""
import time

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

MAX_REQUEST_BYTES = 120_000  # the gateway accepts 128 KB; stay under it


class ModelLimited(Exception):
    """429: usage limit reached. Never retried in a loop."""

    def __init__(self, retry_at):
        super().__init__(f"model usage limit reached, retry_at={retry_at}")
        self.retry_at = retry_at


class ModelUnavailable(Exception):
    """503, or the gateway could not be reached."""


def estimate_tokens(text):
    return len(text) // 4


class GatewayChat(BaseChatModel):
    url: str
    timeout: float = 300
    calls: list = Field(default_factory=list)  # one record per request, for result.json

    @property
    def _llm_type(self):
        return "resurgo-gateway"

    @property
    def _identifying_params(self):
        return {"model_name": "model-gateway"}

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        system = "\n".join(m.content for m in messages if m.type == "system")
        user = "\n\n".join(m.content for m in messages if m.type != "system")
        if len((system + user).encode()) > MAX_REQUEST_BYTES:
            raise ValueError("gateway request exceeds the size limit")
        rec = {"prompt_chars": len(system) + len(user), "started": time.time()}
        self.calls.append(rec)
        try:
            r = httpx.post(f"{self.url.rstrip('/')}/v1/completions",
                           json={"system": system, "user": user}, timeout=self.timeout)
        except httpx.HTTPError as e:
            rec["status"] = "model_unavailable"
            raise ModelUnavailable(f"gateway request failed: {type(e).__name__}") from None
        finally:
            rec["duration_s"] = round(time.time() - rec["started"], 1)
        if r.status_code == 429:
            rec["status"] = "model_limited"
            try:
                retry_at = r.json().get("retry_at")
            except ValueError:
                retry_at = None
            raise ModelLimited(retry_at)
        if r.status_code != 200:
            rec["status"] = "model_unavailable"
            raise ModelUnavailable(f"gateway returned HTTP {r.status_code}")
        data = r.json()
        text = data["text"]
        usage = {"prompt_tokens": estimate_tokens(system + user),
                 "completion_tokens": estimate_tokens(text)}
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        rec.update(status="ok", model=data.get("model"), effort=data.get("effort"),
                   response_chars=len(text), tokens_estimated=usage)
        message = AIMessage(content=text, response_metadata={
            "model": data.get("model"), "effort": data.get("effort"), "token_usage_estimated": True})
        return ChatResult(generations=[ChatGeneration(message=message)], llm_output={
            "model_name": data.get("model"), "effort": data.get("effort"),
            "token_usage": usage, "token_usage_estimated": True})
