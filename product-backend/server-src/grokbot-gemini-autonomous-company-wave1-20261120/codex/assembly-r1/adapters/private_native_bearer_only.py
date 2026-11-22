"""Private local staging: native bearer stays at parent origin, never a cross-port cookie."""
def install_private_native_bearer_only(app):
    @app.middleware("http")
    async def bearer_only(request,call_next):
        response=await call_next(request)
        # Native auth emits one cookie per header. Preserve every unrelated cookie byte-for-byte.
        response.raw_headers=[(name,value) for name,value in response.raw_headers
                              if not(name.lower()==b"set-cookie" and value.lstrip().startswith(b"token="))]
        response.delete_cookie("token",path="/",httponly=True,samesite="lax")
        return response
