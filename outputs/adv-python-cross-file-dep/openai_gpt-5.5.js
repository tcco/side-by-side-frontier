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