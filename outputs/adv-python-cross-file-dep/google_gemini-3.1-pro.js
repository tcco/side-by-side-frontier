# crypto_utils.py
import secrets
import hmac
import hashlib
from typing import Optional

def generate_token(length: int = 32) -> str:
    """
    Generates a cryptographically secure, URL-safe random token.
    """
    return secrets.token_urlsafe(length)

def hash_token(token: str, secret_key: str) -> Optional[str]:
    """
    Computes a SHA-256 HMAC of the token using the server's secret key.
    Returns None if the token or secret_key is empty/malformed.
    """
    if not token or not secret_key:
        return None
        
    try:
        # HMAC requires bytes, so we encode the strings to utf-8
        return hmac.new(
            key=secret_key.encode('utf-8'),
            msg=token.encode('utf-8'),
            digestmod=hashlib.sha256
        ).hexdigest()
    except Exception:
        # Catch any unexpected encoding errors with malformed inputs
        return None