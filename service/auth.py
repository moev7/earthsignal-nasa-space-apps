import hashlib
import hmac
import re
from .store import Problem
from .identity import valid_owner

def canonical(method, target, user, timestamp, nonce, body):
    return '\n'.join((method.upper(), target, user, timestamp, nonce, hashlib.sha256(body).hexdigest())).encode()

def body_limit(method, target):
    # Signed target must be exact; queries, trailing slashes and aliases do not
    # inherit the larger private-input budget.
    return 2 * 1024**2 if method == 'POST' and target == '/api/area-experiments' else 16384

def authenticate(store, method, target, headers, body):
    if len(body) > body_limit(method, target):
        raise Problem(413, 'body_too_large', 'Request body exceeds endpoint limit')
    fields = [headers.get(k, '') for k in ('X-Earthsignal-User', 'X-Earthsignal-Timestamp', 'X-Earthsignal-Nonce', 'X-Earthsignal-Signature')]
    user, timestamp, nonce, signature = fields
    if (not valid_owner(user) or
        not re.fullmatch(r'[0-9]{1,12}', timestamp) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', nonce) or
        not re.fullmatch(r'[0-9a-fA-F]{64}', signature)):
        raise Problem(401, 'unauthorized', 'Valid signed gateway identity required')
    signed_at = int(timestamp)
    if abs(store.clock()-signed_at) > 60:
        raise Problem(401, 'stale_signature', 'Gateway signature expired')
    if len(store.config.secret) < 32:
        raise Problem(503, 'gateway_unavailable', 'Gateway authorization unavailable')
    expected = hmac.new(store.config.secret, canonical(method,target,user,timestamp,nonce,body), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature.lower(), expected):
        raise Problem(401, 'unauthorized', 'Valid signed gateway identity required')
    store.nonce(user, nonce, signed_at)
    return user
