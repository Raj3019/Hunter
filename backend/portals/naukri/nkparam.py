import base64
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

PUBLIC_KEY = b"""-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALrlQ+djR0RjJwBF1xuisHmdFv334MIm
K6LgzJhmLhN7B5yuEyaKoasgXQk3+OQglsOaBxEJ0j5PcTL3nbOvt80CAwEAAQ==
-----END PUBLIC KEY-----"""

_public_key = serialization.load_pem_public_key(PUBLIC_KEY)


def generate_nkparam(page_type: str = "srp") -> str:
    # Native RSA (PKCS1v15) generation — matches Naukri's frontend signing.
    # This is the only path needed; the old Playwright-capture fallback was
    # removed (it was unused and required a headless=False browser).
    timestamp = int(time.time() * 1000)
    message = f"v0|{timestamp}|121_{page_type}".encode("utf-8")
    encrypted = _public_key.encrypt(message, padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("utf-8")
