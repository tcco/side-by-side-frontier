# Secure Token-Based Session Management System

Below is a complete, modular three-file mini-project implementing a secure custom session management system. Each file has a clear responsibility, and they work together to ensure tokens are never stored in plaintext, sessions support sliding expiration, and middleware safely validates incoming requests.

---

## File 1: `crypto_utils.py`

This module handles all cryptographic primitives: generating secure random tokens and computing HMAC-SHA256 hashes. By isolating crypto in its own module, we maintain a clean separation of concerns and make auditing easier.

```python
"""
crypto_utils.py

Cryptographic helpers for the session management system.
- Generates cryptographically secure random tokens.
- Computes HMAC-SHA256 hashes of tokens using a server secret.
"""

import hmac
import hashlib
import secrets
from typing import Final

# Default token length in bytes (256 bits provides strong entropy).
DEFAULT_TOKEN_BYTES: Final[int] = 32


def generate_token(num_bytes: int = DEFAULT_TOKEN_BYTES) -> str:
    """
    Generate a URL-safe, cryptographically secure random token.

    :param num_bytes: Entropy size in bytes (default 32 = 256 bits).
    :return: A URL-safe string token.
    """
    if num_bytes <= 0:
        raise ValueError("num_bytes must be a positive integer")
    return secrets.token_urlsafe(num_bytes)


def hash_token(token: str, secret_key: str) -> str:
    """
    Compute an HMAC-SHA256 hex digest of the given token using the secret key.
    This is used both for storage and lookup (constant-time comparable).

    :param token: The plaintext token to hash.
    :param secret_key: The server-side secret key.
    :return: Hex digest string of the HMAC.
    """
    if not isinstance(token, str) or not token:
        raise ValueError("token must be a non-empty string")
    if not isinstance(secret_key, str) or not secret_key:
        raise ValueError("secret_key must be a non-empty string")

    return hmac.new(
        key=secret_key.encode("utf-8"),
        msg=token.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()


def verify_token(token: str, expected_hash: str, secret_key: str) -> bool:
    """
    Verify a token against an expected HMAC hash using a constant-time comparison.

    :param token: The plaintext token to verify.
    :param expected_hash: The stored HMAC hex digest.
    :param secret_key: The server-side secret key.
    :return: True if the token matches the expected hash, otherwise False.
    """
    try:
        candidate_hash = hash_token(token, secret_key)
    except ValueError:
        return False
    return hmac.compare_digest(candidate_hash, expected_hash)
```

---

## File 2: `session_store.py`

This module implements an in-memory `SessionStore`. Tokens are **never stored in plaintext** — only their HMAC hashes are kept. The store supports sliding expiration, meaning each successful `get` refreshes the TTL.

```python
"""
session_store.py

In-memory session store. Tokens are hashed (HMAC-SHA256) before storage.
Supports sliding-expiration TTL semantics.
"""

import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Any, Tuple

from crypto_utils import generate_token, hash_token, verify_token


@dataclass
class SessionRecord:
    """Internal record stored per session."""
    user_id: str
    created_at: float
    last_accessed: float
    ttl_seconds: int
    data: Dict[str, Any] = field(default_factory=dict)

    def is_expired(self, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.time()
        return (now - self.last_accessed) > self.ttl_seconds


class SessionStore:
    """
    In-memory session store keyed by HMAC-hashed tokens.

    Plaintext tokens are returned to the caller only at creation time.
    The store itself never sees plaintext tokens after `set`.
    """

    def __init__(self, secret_key: str, default_ttl_seconds: int = 1800) -> None:
        if not secret_key:
            raise ValueError("secret_key is required")
        if default_ttl_seconds <= 0:
            raise ValueError("default_ttl_seconds must be positive")

        self._secret_key: str = secret_key
        self._default_ttl: int = default_ttl_seconds
        self._sessions: Dict[str, SessionRecord] = {}

    def set(
        self,
        user_id: str,
        ttl_seconds: Optional[int] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Create a new session and return the plaintext token to the caller.
        The store only retains the hashed form.

        :param user_id: Identifier of the authenticated user.
        :param ttl_seconds: Optional override TTL for sliding expiration.
        :param data: Optional dictionary of arbitrary session data.
        :return: The plaintext token (to be delivered to the client).
        """
        if not user_id:
            raise ValueError("user_id is required")

        token: str = generate_token()
        token_hash: str = hash_token(token, self._secret_key)
        now: float = time.time()

        self._sessions[token_hash] = SessionRecord(
            user_id=user_id,
            created_at=now,
            last_accessed=now,
            ttl_seconds=ttl_seconds if ttl_seconds is not None else self._default_ttl,
            data=dict(data) if data else {},
        )
        return token

    def get(self, token: str) -> Optional[SessionRecord]:
        """
        Look up a session by plaintext token.
        Refreshes `last_accessed` on success (sliding expiration).
        Returns None if not found, malformed, or expired.

        :param token: The plaintext token from the client.
        :return: SessionRecord if valid, otherwise None.
        """
        if not isinstance(token, str) or not token:
            return None

        try:
            token_hash: str = hash_token(token, self._secret_key)
        except ValueError:
            return None

        record: Optional[SessionRecord] = self._sessions.get(token_hash)
        if record is None:
            return None

        # Verify integrity with constant-time comparison.
        if not verify_token(token, token_hash, self._secret_key):
            return None

        now: float = time.time()
        if record.is_expired(now):
            # Clean up expired session.
            self._sessions.pop(token_hash, None)
            return None

        # Sliding expiration: refresh last-access timestamp.
        record.last_accessed = now
        return record

    def invalidate(self, token: str) -> bool:
        """
        Invalidate (delete) the session associated with the given token.

        :param token: The plaintext token to invalidate.
        :return: True if a session was removed, False otherwise.
        """
        if not isinstance(token, str) or not token:
            return False
        try:
            token_hash: str = hash_token(token, self._secret_key)
        except ValueError:
            return False
        return self._sessions.pop(token_hash, None) is not None

    def purge_expired(self) -> int:
        """
        Remove all expired sessions. Useful as a periodic cleanup task.

        :return: Number of sessions purged.
        """
        now: float = time.time()
        expired_keys: Tuple[str, ...] = tuple(
            k for k, rec in self._sessions.items() if rec.is_expired(now)
        )
        for k in expired_keys:
            self._sessions.pop(k, None)
        return len(expired_keys)

    def __len__(self) -> int:
        return len(self._sessions)
```

---

## File 3: `middleware.py`

This module simulates an HTTP middleware layer. It extracts a Bearer token from the mock request headers, validates it against the `SessionStore`, and attaches the user context to the request object. Malformed tokens, missing headers, and expired sessions are gracefully handled.

```python
"""
middleware.py

Simulated HTTP middleware that extracts a token from request headers,
validates it via the SessionStore, and binds session/user context.
"""

from typing import Dict, Any, Optional

from session_store import SessionStore, SessionRecord


# A "request" is modeled as a simple mutable dict for demonstration.
Request = Dict[str, Any]


AUTH_HEADER: str = "Authorization"
BEARER_PREFIX: str = "Bearer "


def _extract_token(headers: Dict[str, str]) -> Optional[str]:
    """
    Extract a bearer token from request headers. Returns None if missing
    or malformed.
    """
    if not isinstance(headers, dict):
        return None

    # Case-insensitive header lookup.
    auth_value: Optional[str] = None
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == AUTH_HEADER.lower():
            auth_value = value
            break

    if not isinstance(auth_value, str):
        return None
    if not auth_value.startswith(BEARER_PREFIX):
        return None

    token: str = auth_value[len(BEARER_PREFIX):].strip()
    return token or None


class SessionMiddleware:
    """
    Middleware that binds a session context to incoming requests.
    """

    def __init__(self, store: SessionStore) -> None:
        self._store = store

    def process_request(self, request: Request) -> Request:
        """
        Inspect the request, validate its token, and attach user context.

        On success, request['user'] and request['session'] are populated.
        On failure, both fields are set to None and request['auth_error']
        contains a brief reason. The middleware never raises.
        """
        request.setdefault("user", None)
        request.setdefault("session", None)
        request.setdefault("auth_error", None)

        headers: Dict[str, str] = request.get("headers", {}) or {}
        token: Optional[str] = _extract_token(headers)

        if token is None:
            request["auth_error"] = "missing_or_malformed_token"
            return request

        try:
            record: Optional[SessionRecord] = self._store.get(token)
        except Exception:
            # Defensive: never let a store-level error crash the middleware.
            request["auth_error"] = "session_lookup_failed"
            return request

        if record is None:
            request["auth_error"] = "invalid_or_expired_session"
            return request

        request["user"] = record.user_id
        request["session"] = {
            "created_at": record.created_at,
            "last_accessed": record.last_accessed,
            "ttl_seconds": record.ttl_seconds,
            "data": dict(record.data),
        }
        return request


# ---------------------------------------------------------------------------
# Demonstration / manual smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    SECRET: str = "super-secret-server-key-change-me"

    store = SessionStore(secret_key=SECRET, default_ttl_seconds=60)
    middleware = SessionMiddleware(store)

    # 1. Create a session for an authenticated user.
    token: str = store.set(user_id="alice", data={"role": "admin"})
    print(f"Issued token: {token[:16]}... (truncated)")

    # 2. Valid request.
    req_valid: Request = {"headers": {"Authorization": f"Bearer {token}"}}
    middleware.process_request(req_valid)
    print("Valid request ->", {"user": req_valid["user"], "error": req_valid["auth_error"]})

    # 3. Missing header.
    req_missing: Request = {"headers": {}}
    middleware.process_request(req_missing)
    print("Missing header ->", {"user": req_missing["user"], "error": req_missing["auth_error"]})

    # 4. Malformed header.
    req_malformed: Request = {"headers": {"Authorization": "Token abc.def"}}
    middleware.process_request(req_malformed)
    print("Malformed ->", {"user": req_malformed["user"], "error": req_malformed["auth_error"]})

    # 5. Forged / unknown token.
    req_forged: Request = {"headers": {"Authorization": "Bearer not-a-real-token"}}
    middleware.process_request(req_forged)
    print("Forged ->", {"user": req_forged["user"], "error": req_forged["auth_error"]})

    # 6. Invalidation.
    store.invalidate(token)
    req_after_logout: Request = {"headers": {"Authorization": f"Bearer {token}"}}
    middleware.process_request(req_after_logout)
    print("After logout ->", {"user": req_after_logout["user"], "error": req_after_logout["auth_error"]})
```

---

## Design Highlights

1. **Tokens never stored in plaintext.** `SessionStore.set` generates a token via `secrets.token_urlsafe`, hashes it with HMAC-SHA256 using the server's secret, and stores only the hash as the dict key. The plaintext is returned once to the caller.

2. **Constant-time comparison.** `verify_token` uses `hmac.compare_digest` to thwart timing attacks during token validation.

3. **Sliding expiration.** Each successful `get` updates `last_accessed`, so active users stay logged in while idle sessions expire after `ttl_seconds`.

4. **Robust middleware.** `SessionMiddleware.process_request` handles missing headers, wrong schemes, malformed bearer values, unknown tokens, expired sessions, and unexpected exceptions — never raising. It always returns a request with `user`, `session`, and `auth_error` populated.

5. **Clean imports.** All imports are flat (`from crypto_utils import ...`, `from session_store import ...`), so placing the three files in the same directory makes the project runnable with `python middleware.py`.

6. **Type hints throughout.** Function signatures, dataclass fields, and locals use explicit annotations for clarity and tooling support.

Run a smoke test simply with:

```bash
python middleware.py
```

You'll see successful authentication, then graceful rejection of missing, malformed, forged, and invalidated tokens.