import time
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import jwt


def make_keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return key, pem_priv


def issue_id_token(*, sub: str, email: str, aud: str, kid: str, key) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "sub": sub,
            "email": email,
            "aud": aud,
            "iat": now,
            "exp": now + 3600,
            "email_verified": True,
            "name": "Test",
        },
        key,
        algorithm="RS256",
        headers={"kid": kid},
    )
