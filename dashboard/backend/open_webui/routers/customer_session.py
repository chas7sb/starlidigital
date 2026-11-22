"""Explicit sealed authority for customer tokens entering company native sessions.

This is not a JWT and is never accepted by ordinary authenticated HTTP routes.
"""
from weakref import WeakSet
from company_messaging.native_mount import NativeSession

_SEAL=object()
_ISSUED=WeakSet()
class CustomerSession(NativeSession):
    __hash__=object.__hash__
    __eq__=object.__eq__
    def __init__(self,seal,user_id,token_id,expires_at,revalidate):
        if seal is not _SEAL:raise TypeError('Server-issued customer authority required')
        super().__init__(user_id,token_id,expires_at,'customer-token',revalidate)
        _ISSUED.add(self)

def issue(user_id,token_id,expires_at,revalidate):
    if revalidate() is not True:raise PermissionError('Customer authority unavailable')
    return CustomerSession(_SEAL,user_id,token_id,expires_at,revalidate)

def authentic(session):
    return type(session) is CustomerSession and session in _ISSUED
