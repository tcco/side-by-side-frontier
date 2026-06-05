Below is a complete three-file mini-project. Place the files in the same directory. The import shims support both package-style relative imports and direct local execution/imports.

---

## `crypto_utils.py`

```python
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Final, TypeGuard

MIN_TOKEN_BYTES: Final[int] = 16          # 128 bits minimum entropy
DEFAULT_TOKEN_BYTES: Final[int] = 32      # 256 bits entropy
MAX_TOKEN_BYTES: Final[int] = 384         # token_urlsafe(384) is 512 chars

MIN_TOKEN_LENGTH: Final[int] = 22         # token_urlsafe(16) length
MAX_TOKEN_LENGTH: Final[int] = 512

_MIN_SECRET_KEY_BYTES: Final[int] = 32    # 256-bit server secret minimum

_TOKEN_PATTERN: Final[re.Pattern[str]] = re.compile(
    rf"^[A-Za-z0-9_-]{{{MIN_TOKEN_LENGTH},{MAX_TOKEN_LENGTH}}}$"
)


def generate_token(num_bytes: int = DEFAULT_TOKEN_BYTES) -> str:
    """
    Generate a cryptographically secure URL-safe bearer token.

    Args:
        num_bytes: Number of random bytes before URL-safe base64 encoding.

    Returns:
        A URL-safe random token string.

    Raises:
        TypeError: If num_bytes is not an int.
        ValueError: If num_bytes is outside the supported secure range.
    """
    if not isinstance(num_bytes, int):
        raise TypeError("num_bytes must be an int")

    if num_bytes < MIN_TOKEN_BYTES:
        raise ValueError(f"num_bytes must be at least {MIN_TOKEN_BYTES}")

    if num_bytes > MAX_TOKEN_BYTES:
        raise ValueError(f"num_bytes must be at most {MAX_TOKEN_BYTES}")

    return secrets.token_urlsafe(num_bytes)


def is_well_formed_token(token: object) -> TypeGuard[str]:
    """
    Validate token shape without checking whether it exists in the session store.

    This intentionally only validates syntax/size. Authenticity is established
    by looking up the token's keyed HMAC in the session store.
    """
    return isinstance(token, str) and _TOKEN_PATTERN.fullmatch(token) is not None


def normalize_secret_key(server_secret_key: bytes | str) -> bytes:
    """
    Normalize and validate the server secret key used for HMAC.

    Args:
        server_secret_key: Secret key as bytes or UTF-8 string.

    Returns:
        Secret key as bytes.

    Raises:
        TypeError: If the key is neither bytes nor str.
        ValueError: If the key is too short.
    """
    if isinstance(server_secret_key, str):
        key = server_secret_key.encode("utf-8")
    elif isinstance(server_secret_key, bytes):
        key = server_secret_key
    else:
        raise TypeError("server_secret_key must be bytes or str")

    if len(key) < _MIN_SECRET_KEY_BYTES:
        raise ValueError(
            f"server_secret_key must be at least {_MIN_SECRET_KEY_BYTES} bytes"
        )

    return key


def compute_token_hmac(token: str, server_secret_key: bytes | str) -> str:
    """
    Compute the SHA-256 HMAC of a session token using the server secret key.

    The returned digest is safe to store. The original plaintext token should
    only be given to the client and should never be persisted server-side.

    Args:
        token: Well-formed session token.
        server_secret_key: Server-side HMAC secret.

    Returns:
        Hex-encoded SHA-256 HMAC digest.

    Raises:
        ValueError: If the token is malformed or the secret is too short.
        TypeError: If the secret key type is invalid.
    """
    if not is_well_formed_token(token):
        raise ValueError("malformed session token")

    key = normalize_secret_key(server_secret_key)
    return hmac.new(key, token.encode("ascii"), hashlib.sha256).hexdigest()
```

---

## `session_store.py`

```python
from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from threading import RLock
from typing import Any

try:
    from .crypto_utils import (
        compute_token_hmac,
        generate_token,
        is_well_formed_token,
        normalize_secret_key,
    )
except ImportError:
    from crypto_utils import (
        compute_token_hmac,
        generate_token,
        is_well_formed_token,
        normalize_secret_key,
    )


@dataclass(slots=True)
class _SessionRecord:
    user_context: dict[str, Any]
    created_at: float
    last_accessed_at: float
    expires_at: float


class SessionStore:
    """
    In-memory session store with keyed-HMAC token storage and sliding expiration.

    Security properties:
    - Plaintext tokens are never stored.
    - Stored keys are SHA-256 HMAC digests of tokens using a server secret.
    - Expiration is sliding: every successful get() extends the expiration time.
    - Malformed, missing, expired, or unknown tokens return None/False instead
      of raising in lookup/invalidation paths.
    """

    def __init__(
        self,
        server_secret_key: bytes | str,
        ttl_seconds: float,
        *,
        time_func: Callable[[], float] | None = None,
    ) -> None:
        """
        Args:
            server_secret_key: Secret key used to HMAC tokens before storage.
            ttl_seconds: Sliding expiration TTL in seconds.
            time_func: Optional monotonic time provider, useful for tests.

        Raises:
            ValueError: If ttl_seconds is not positive or secret is too short.
            TypeError: If secret type is invalid.
        """
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")

        self._server_secret_key: bytes = normalize_secret_key(server_secret_key)
        self._ttl_seconds: float = float(ttl_seconds)
        self._time_func: Callable[[], float] = time_func or time.monotonic
        self._sessions: dict[str, _SessionRecord] = {}
        self._lock: RLock = RLock()

    def set(self, user_context: Mapping[str, Any], token: str | None = None) -> str:
        """
        Create or replace a session.

        Args:
            user_context: Serializable user/session context to bind to token.
            token: Optional pre-generated token. If omitted, a secure token is
                   generated.

        Returns:
            The plaintext token. Give this to the client once.

        Raises:
            TypeError: If user_context is not a mapping.
            ValueError: If a provided token is malformed.
        """
        if not isinstance(user_context, Mapping):
            raise TypeError("user_context must be a mapping")

        session_token = token if token is not None else generate_token()

        if not is_well_formed_token(session_token):
            raise ValueError("malformed session token")

        now = self._time_func()
        digest = self._hash_token(session_token)

        record = _SessionRecord(
            user_context=dict(user_context),
            created_at=now,
            last_accessed_at=now,
            expires_at=now + self._ttl_seconds,
        )

        with self._lock:
            self._sessions[digest] = record

        return session_token

    def get(self, token: object) -> dict[str, Any] | None:
        """
        Retrieve a session by plaintext token and slide its expiration.

        Args:
            token: Plaintext bearer token supplied by the client.

        Returns:
            A shallow copy of the user context if valid and unexpired, otherwise
            None.
        """
        if not is_well_formed_token(token):
            return None

        digest = self._hash_token(token)
        now = self._time_func()

        with self._lock:
            record = self._sessions.get(digest)

            if record is None:
                return None

            if record.expires_at <= now:
                self._sessions.pop(digest, None)
                return None

            # Sliding expiration: extend TTL on successful access.
            record.last_accessed_at = now
            record.expires_at = now + self._ttl_seconds

            return dict(record.user_context)

    def invalidate(self, token: object) -> bool:
        """
        Invalidate a session by plaintext token.

        Args:
            token: Plaintext bearer token.

        Returns:
            True if a session was removed, False otherwise.
        """
        if not is_well_formed_token(token):
            return False

        digest = self._hash_token(token)

        with self._lock:
            return self._sessions.pop(digest, None) is not None

    def cleanup_expired(self) -> int:
        """
        Remove expired sessions.

        Returns:
            Number of expired sessions removed.
        """
        now = self._time_func()

        with self._lock:
            expired_digests = [
                digest
                for digest, record in self._sessions.items()
                if record.expires_at <= now
            ]

            for digest in expired_digests:
                self._sessions.pop(digest, None)

            return len(expired_digests)

    def __len__(self) -> int:
        """
        Return the number of currently stored records.

        Note:
            This may include expired records until get(), invalidate(), or
            cleanup_expired() removes them.
        """
        with self._lock:
            return len(self._sessions)

    def _hash_token(self, token: str) -> str:
        return compute_token_hmac(token, self._server_secret_key)
```

---

## `middleware.py`

```python
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

try:
    from .session_store import SessionStore
except ImportError:
    from session_store import SessionStore


@dataclass(slots=True)
class MockRequest:
    """
    Minimal mock HTTP request context.

    Attributes:
        headers: Mock HTTP headers.
        user_context: Bound authenticated session context, if validation passes.
        session_token: Plaintext token from the request, if validation passes.
        is_authenticated: True only when the session is valid and unexpired.
        auth_error: Machine-readable authentication failure reason.
    """

    headers: Mapping[str, str]
    user_context: dict[str, Any] | None = None
    session_token: str | None = None
    is_authenticated: bool = False
    auth_error: str | None = None


class SessionMiddleware:
    """
    Middleware-style session validator for mock HTTP requests.

    Supported token locations:
    - Authorization: Bearer <token>
    - X-Session-Token: <token>

    The middleware never crashes on malformed/missing headers or bad tokens.
    Invalid, expired, unknown, or malformed tokens simply produce an unauthenticated
    request context.
    """

    def __init__(
        self,
        session_store: SessionStore,
        *,
        authorization_header: str = "Authorization",
        token_header: str = "X-Session-Token",
    ) -> None:
        self._session_store: SessionStore = session_store
        self._authorization_header: str = authorization_header
        self._token_header: str = token_header

    def process_request(self, request: MockRequest) -> MockRequest:
        """
        Validate the request token and bind session context to the request.

        Args:
            request: Mock request object.

        Returns:
            The same request object, updated with auth/session fields.
        """
        self._clear_request_context(request)

        try:
            token = self._extract_token(request.headers)

            if token is None:
                request.auth_error = "missing_or_malformed_session_token"
                return request

            user_context = self._session_store.get(token)

            if user_context is None:
                request.auth_error = "invalid_or_expired_session"
                return request

            request.session_token = token
            request.user_context = user_context
            request.is_authenticated = True
            request.auth_error = None
            return request

        except Exception:
            # Defensive boundary: middleware should not crash request handling.
            self._clear_request_context(request)
            request.auth_error = "session_validation_failed"
            return request

    def _extract_token(self, headers: Mapping[str, str]) -> str | None:
        if not isinstance(headers, Mapping):
            return None

        authorization_value = self._get_header(headers, self._authorization_header)
        bearer_token = self._parse_authorization_header(authorization_value)

        if bearer_token is not None:
            return bearer_token

        raw_token_value = self._get_header(headers, self._token_header)
        return self._parse_raw_token_header(raw_token_value)

    @staticmethod
    def _get_header(headers: Mapping[str, str], name: str) -> str | None:
        target = name.lower()

        for key, value in headers.items():
            if isinstance(key, str) and key.lower() == target:
                return value if isinstance(value, str) else None

        return None

    @classmethod
    def _parse_authorization_header(cls, value: str | None) -> str | None:
        if value is None:
            return None

        parts = value.strip().split()

        if len(parts) != 2:
            return None

        scheme, token = parts

        if scheme.lower() != "bearer":
            return None

        return cls._parse_single_token_value(token)

    @classmethod
    def _parse_raw_token_header(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return cls._parse_single_token_value(value)

    @staticmethod
    def _parse_single_token_value(value: str) -> str | None:
        token = value.strip()

        if not token:
            return None

        # Reject values with spaces, tabs, newlines, or multiple tokens.
        if len(token.split()) != 1:
            return None

        return token

    @staticmethod
    def _clear_request_context(request: MockRequest) -> None:
        request.user_context = None
        request.session_token = None
        request.is_authenticated = False
        request.auth_error = None
```

---

### Minimal usage example

```python
from session_store import SessionStore
from middleware import MockRequest, SessionMiddleware

secret = "change-me-to-a-long-random-server-secret-32-bytes-min"
store = SessionStore(secret, ttl_seconds=900)

token = store.set({"user_id": "user-123", "role": "admin"})

middleware = SessionMiddleware(store)
request = MockRequest(headers={"Authorization": f"Bearer {token}"})

middleware.process_request(request)

assert request.is_authenticated is True
assert request.user_context == {"user_id": "user-123", "role": "admin"}
```