"""Bridge native EmailCall to the existing service's INTERNAL worker operations."""
from starlette.concurrency import run_in_threadpool
from email_runtime import EmailCall
def bind_email_native_adapter(rpc):
 async def draft(bound,args,authorize):
  if not isinstance(bound,EmailCall):raise PermissionError('Native EmailCall required')
  await authorize();native=bound.native_scope
  payload=dict(args,nativeOperationId=bound.operation_id)
  result=await run_in_threadpool(rpc.call,'tool-draft',native.actor_id,native.company_id,args.get('resourceId',''),payload)
  await authorize();return dict(companyId=result['companyId'],resourceId=result['id'],revision=result['revision'])
 async def review(bound,args,authorize):
  if not isinstance(bound,EmailCall):raise PermissionError('Native EmailCall required')
  await authorize();native=bound.native_scope
  result=await run_in_threadpool(rpc.call,'review',native.actor_id,native.company_id,args['resourceId'],dict(expectedRevision=args['expectedRevision']))
  await authorize();return dict(companyId=native.company_id,resourceId=result['draftId'],revision=result['revision'])
 return draft,review
