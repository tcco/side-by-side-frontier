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