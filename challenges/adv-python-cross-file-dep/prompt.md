Generate a complete, modular, three-file mini-project in Python implementing a secure, custom token-based session management system. You must output the entire contents of all three files clearly within this single prompt.

crypto_utils.py: Contains functions to generate a cryptographically secure random token and compute its SHA-256 HMAC using a provided server secret key.

session_store.py: Emplements an in-memory SessionStore class utilizing a dictionary. It must depend on crypto_utils.py to hash tokens before storing them (ensuring tokens are never stored in plaintext). It should include methods to set, get, and invalidate sessions with an explicit sliding expiration TTL.

middleware.py: Simulates an HTTP request context. It imports session_store.py, extracts a token from a mock request header dict, validates its authenticity and expiration, and binds the session user context to the request.

Ensure all relative imports are perfectly valid, type hints are explicitly used throughout, and edge cases (like malformed tokens or expired sessions) are handled without crashing the middleware.