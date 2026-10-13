# pip install "pyjwt[crypto]"
import os
import time
import uuid

import jwt

PRIVATE_KEY = os.environ["DOCENT_PRIVATE_KEY"]


def docent_token(user: dict[str, str | int]) -> str:
    now = int(time.time())
    claims = {
        "iss": os.environ["DOCENT_WIDGET_ID"],
        "aud": "docent",
        "sub": str(user["id"]),
        "iat": now,
        "exp": now + 300,
        "jti": uuid.uuid4().hex,
        "name": user["name"],
        "email": user["email"],
        "ctx": {"plan": user["plan"]},
    }
    return jwt.encode(
        claims, PRIVATE_KEY, algorithm="ES256", headers={"kid": os.environ["DOCENT_KEY_ID"]}
    )


# Flask, behind your login check:
# @app.get("/docent-token")
# @login_required
# def token():
#     return docent_token(current_user.to_dict())

if __name__ == "__main__":
    user = {"id": "user-123", "name": "Ana Souza", "email": "ana@example.com", "plan": "Team"}
    print(docent_token(user))
