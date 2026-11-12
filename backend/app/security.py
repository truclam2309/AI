from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import HTTPException

from .config import settings


def _secret() -> bytes:
    if not settings.secret_key:
        raise RuntimeError("Set NUTRIAI_SECRET_KEY trước khi chạy backend.")
    return settings.secret_key.encode("utf-8")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return "scrypt${}${}${}".format(
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
        "16384-8-1",
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt_text, digest_text, _params = encoded.split("$", 3)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: int) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": str(user_id), "iat": now, "exp": now + settings.token_ttl_seconds}
    encode = lambda item: base64.urlsafe_b64encode(json.dumps(item, separators=(",", ":")).encode()).rstrip(b"=").decode()
    signing_input = f"{encode(header)}.{encode(payload)}"
    signature = base64.urlsafe_b64encode(hmac.new(_secret(), signing_input.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{signing_input}.{signature}"


def decode_access_token(token: str) -> int:
    try:
        head, payload_part, signature = token.split(".")
        signing_input = f"{head}.{payload_part}"
        expected = base64.urlsafe_b64encode(hmac.new(_secret(), signing_input.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4)))
        if payload["exp"] < int(time.time()):
            raise ValueError
        return int(payload["sub"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn.")
