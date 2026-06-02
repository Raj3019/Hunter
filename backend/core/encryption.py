from cryptography.fernet import Fernet
from core.config import ENCRYPTION_KEY

_fernet: Fernet = None

def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if not ENCRYPTION_KEY:
            raise RuntimeError("ENCRYPTION_KEY not set in environment")
        _fernet = Fernet(ENCRYPTION_KEY.encode())
    return _fernet

def encrypt(plain_text: str) -> str:
    return _get_fernet().encrypt(plain_text.encode()).decode()

def decrypt(encrypted_text: str) -> str:
    return _get_fernet().decrypt(encrypted_text.encode()).decode()