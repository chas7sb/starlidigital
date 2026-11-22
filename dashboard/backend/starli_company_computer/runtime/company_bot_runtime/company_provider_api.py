"""Company vault router; host supplies the actual verified-session dependency."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
try:
    from .company_providers import Denied
except ImportError:
    from company_providers import Denied


class SafeRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def safe(request):
            try:
                response=await handler(request)
            except RequestValidationError:
                response=JSONResponse({'detail':'PROVIDER_REQUEST_INVALID'},status_code=422)
            except HTTPException as error:
                response=JSONResponse({'detail':error.detail},status_code=error.status_code)
            response.headers['Cache-Control']='no-store'
            return response
        return safe


class Connect(BaseModel):
    provider: str = Field(min_length=1,max_length=180)
    credential: dict
    class Config:
        extra='forbid'


class Rotate(BaseModel):
    credential: dict
    expectedRevision: int = Field(ge=1)
    class Config:
        extra='forbid'


class Choose(BaseModel):
    connectionId: str | None = None
    model: str = Field(min_length=1,max_length=180)
    expectedRevision: int = Field(ge=0)
    class Config:
        extra='forbid'

class Refresh(BaseModel):
    expectedRevision: int = Field(ge=1)
    class Config:
        extra='forbid'


class CompanyAccountConsent(BaseModel):
    consentCompanyScope: bool = False
    class Config:
        extra='forbid'

def create_router(store, verified_user):
    router=APIRouter(prefix='/api/v1/companies',route_class=SafeRoute)
    def invoke(call):
        try: return call()
        except Denied as e:
            code=str(e)
            raise HTTPException(status_code=409 if 'CONFLICT' in code else 403,detail=code) from None
        except Exception:
            raise HTTPException(status_code=503,detail='PROVIDER_SERVICE_UNAVAILABLE') from None

    @router.get('/{company}/provider-account')
    def company_account(company:str,user=Depends(verified_user)):
        return invoke(lambda:store.company_account(user.id,company))

    @router.post('/{company}/provider-account')
    def share_company_account(company:str,form:CompanyAccountConsent,user=Depends(verified_user)):
        return {**invoke(lambda:store.connect_company_account(user.id,company,form.consentCompanyScope)), 'companyId':company}

    @router.get('/{company}/provider-connections')
    def connections(company:str,user=Depends(verified_user)):
        return invoke(lambda:store.connections(user.id,company))

    @router.post('/{company}/provider-connections')
    def connect(company:str,form:Connect,user=Depends(verified_user)):
        return {'connectionId':invoke(lambda:store.connect(user.id,company,form.provider,form.credential))}

    @router.put('/{company}/provider-connections/{connection}/credential')
    def rotate(company:str,connection:str,form:Rotate,user=Depends(verified_user)):
        return {'revision':invoke(lambda:store.rotate(user.id,company,connection,form.credential,form.expectedRevision))}

    @router.delete('/{company}/provider-connections/{connection}')
    def disconnect(company:str,connection:str,user=Depends(verified_user)):
        invoke(lambda:store.disconnect(user.id,company,connection))
        return {'disconnected':True}

    @router.post('/{company}/provider-connections/{connection}/models/refresh')
    def refresh(company:str,connection:str,form:Refresh,user=Depends(verified_user)):
        return invoke(lambda:store.refresh(user.id,company,connection,form.expectedRevision))

    @router.get('/{company}/bots/{bot}/provider-options')
    def options(company:str,bot:str,user=Depends(verified_user)):
        return {'options':invoke(lambda:store.options(user.id,company,bot))}

    @router.put('/{company}/bots/{bot}/provider-selection')
    def choose(company:str,bot:str,form:Choose,user=Depends(verified_user)):
        return {'revision':invoke(lambda:store.choose(user.id,company,bot,form.connectionId,form.model,form.expectedRevision))}

    @router.get('/{company}/bots/{bot}/provider-selection')
    def selection(company:str,bot:str,user=Depends(verified_user)):
        return invoke(lambda:store.public_selection(user.id,company,bot))
    return router
