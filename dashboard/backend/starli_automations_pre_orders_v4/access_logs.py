"""Redact sensitive OAuth callback queries only; retain other access logging."""
import logging,re
PATH=re.compile(r'^/api/v1/starli/(?:automations/oauth/(?:slack|shopify)/(?:return|callback)|companies/[^/]+/automations/connections/(?:slack|shopify)/callback)$')
class OAuthQueryFilter(logging.Filter):
    def filter(self,record):
        args=record.args
        if isinstance(args,tuple) and len(args)>=3 and isinstance(args[2],str):
            target=args[2];path=target.split('?',1)[0]
            if PATH.fullmatch(path):
                cleaned=list(args);cleaned[2]=path;record.args=tuple(cleaned)
        return True
def install():
    logger=logging.getLogger('uvicorn.access')
    if not any(isinstance(f,OAuthQueryFilter) for f in logger.filters):logger.addFilter(OAuthQueryFilter())
