"""Bounded native node JSON results; never expose workflow definitions or IDs."""
import json,re
SECRET=re.compile(r'(password|passwd|secret|token|authorization|cookie|credential|private.?key|api.?key|workflowdata|binary)',re.I)
def outputs(execution,names,private_values):
    hidden=tuple(value for value in private_values if type(value)is str and value)
    budget=[28000]
    def clean(value,depth=0):
        if depth>8 or budget[0]<=0:return '[truncated]'
        if type(value)is dict:
            return {key:clean(item,depth+1) for key,item in list(value.items())[:80] if type(key)is str and not SECRET.search(key) and not any(part in key for part in hidden)}
        if type(value)is list:return [clean(item,depth+1) for item in value[:20]]
        if type(value)is str:
            if any(part in value for part in hidden):return '[redacted]'
            value=value[:2000];budget[0]-=len(value);return value
        if type(value)in (int,float,bool) or value is None:budget[0]-=16;return value
        return '[unsupported]'
    run_data=execution.get('data',{}).get('resultData',{}).get('runData',{})
    if type(run_data)is not dict:return {}
    result={}
    for name in names:
        runs=run_data.get(name,[])
        if type(runs)is not list:continue
        values=[]
        for run in runs[:2]:
            main=run.get('data',{}).get('main',[]) if type(run)is dict else []
            if type(main)is not list:continue
            for branch in main[:4]:
                if type(branch)is list:
                    values.extend(clean(item['json']) for item in branch[:20] if type(item)is dict and 'json'in item)
        if values:result[name]=values[:20]
    # Bound serialized size as well as element/depth/string limits.
    while len(json.dumps(result,allow_nan=False).encode())>32768 and result:result.pop(next(reversed(result)))
    return result


def safe_failure(execution,private_values=()):
    """Allow only bounded error classification, never messages/requests/HTML."""
    data=execution.get('data')
    if type(data)is not dict:return {}
    result=data.get('resultData')
    if type(result)is not dict:return {}
    error=result.get('error')
    if type(error)is not dict:return {}
    hidden=tuple(value for value in private_values if type(value)is str and value)
    safe={}
    name=error.get('name')
    if type(name)is str and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,63}',name) and not SECRET.search(name) and not any(value in name for value in hidden):safe['name']=name
    http=error.get('httpCode')
    if type(http)is int and 100<=http<=599 or type(http)is str and re.fullmatch('[1-5][0-9]{2}',http):safe['httpCode']=int(http)
    code=error.get('code')
    if type(code)is int and 100<=code<=599:safe['code']=code
    elif type(code)is str and (re.fullmatch('E[A-Z0-9_]{1,63}',code) or re.fullmatch('[1-5][0-9]{2}',code)) and not SECRET.search(code) and not any(value in code for value in hidden):safe['code']=code
    return safe
