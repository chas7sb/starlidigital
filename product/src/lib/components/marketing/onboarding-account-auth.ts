export async function authenticateOnboardingAccount(opts:{
 mode:'signin'|'signup';name:string;email:string;password:string;signal:AbortSignal;fetcher?:typeof fetch
}):Promise<{token:string;account:any}>{
 if(!opts.email.trim()||!opts.password||(opts.mode==='signup'&&!opts.name.trim()))throw Error('Complete the account details to continue.');
 const fetcher=opts.fetcher||fetch;
 const response=await fetcher('/api/v1/auths/'+opts.mode,{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
  body:JSON.stringify(opts.mode==='signup'?{name:opts.name,email:opts.email,password:opts.password}:{email:opts.email,password:opts.password}),
  signal:opts.signal
 });
 if(!response.ok)throw Error(response.status===429?'Please wait before trying again.':opts.mode==='signup'?'Account creation was not accepted. Check your details or sign in.':'Sign-in was not accepted. Check your email and password.');
 const session=await response.json();
 if(typeof session?.token!=='string'||!session.token.trim())throw Error('The account service did not return a session.');
 const verify=await fetcher('/api/v1/auths/',{headers:{Authorization:'Bearer '+session.token,Accept:'application/json'},signal:opts.signal});
 if(!verify.ok)throw Error('The signed-in account could not be verified. Please try again.');
 const account=await verify.json();
 if(!account||typeof account.id!=='string'||!account.id.trim())throw Error('The signed-in account could not be verified. Please try again.');
 if(typeof session.id==='string'&&session.id!==account.id)throw Error('The returned session does not match the verified account.');
 return {token:session.token,account};
}
