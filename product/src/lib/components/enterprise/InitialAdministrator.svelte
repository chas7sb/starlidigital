<script lang="ts">
 export let createAdministrator:(input:{name:string;email:string;password:string;companyName:string})=>Promise<void>;
 export let refreshStatus:()=>Promise<void>;
 let name='',email='',companyName='',password='',confirmation='',busy=false,error='';
 async function submit(){
  if(busy)return;
  error='';
  if(!name.trim()||!email.trim()||!companyName.trim()){error='Complete the administrator and company details.';return;}
  if(password!==confirmation){error='The passwords do not match.';return;}
  if(password.length<14||new TextEncoder().encode(password).length>72){error='Use a password of at least 14 characters and at most 72 UTF-8 bytes.';return;}
  busy=true;
  try{await createAdministrator({name:name.trim(),email:email.trim(),password,companyName:companyName.trim()});}
  catch(cause){error=(cause as Error).message;}
  finally{password='';confirmation='';busy=false;}
 }
</script>

<main class="initial-setup">
 <section class="setup-card" aria-labelledby="initial-admin-title">
  <div class="brand"><span aria-hidden="true">✦</span> Starli</div>
  <h1 id="initial-admin-title">Create initial administrator</h1>
  <p>Set up the administrator and the single company for this installation. After setup, this screen is replaced by sign-in.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <form on:submit|preventDefault={submit}>
   <label>Your name<input bind:value={name} autocomplete="name" required maxlength="120" disabled={busy}/></label>
   <label>Administrator email<input bind:value={email} type="email" autocomplete="username" required maxlength="254" disabled={busy}/></label>
   <label>Company name<input bind:value={companyName} autocomplete="organization" required maxlength="120" disabled={busy}/></label>
   <label>Password<input bind:value={password} type="password" autocomplete="new-password" required minlength="14" disabled={busy}/></label>
   <label>Confirm password<input bind:value={confirmation} type="password" autocomplete="new-password" required minlength="14" disabled={busy}/></label>
   <button class="primary" type="submit" disabled={busy}>{busy?'Creating administrator…':'Create initial administrator'}</button>
  </form>
  <button class="refresh" type="button" disabled={busy} on:click={refreshStatus}>Check installation status</button>
 </section>
</main>
<style>.initial-setup{box-sizing:border-box;min-height:100dvh;height:100dvh;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:32px 20px;background:#f4f7ff;color:#17243f;font:14px Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.setup-card{margin-block:auto;flex:none;box-sizing:border-box;width:min(460px,100%);padding:32px;background:#fff;border:1px solid #dfe6f2;border-radius:16px;box-shadow:0 12px 40px #1e3a8a08}.brand{font-size:24px;font-weight:650}.brand span{color:#5372ff}h1{font-size:22px;margin:24px 0 12px}p{font-size:13px;line-height:1.7;color:#64748b}form{display:grid;gap:16px;margin-top:24px}label{display:grid;gap:7px;font-size:12px;font-weight:600}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #dfe6f2;border-radius:8px;background:#fafdff;color:#17243f;font:inherit}button{border:0;border-radius:8px;padding:12px;font:inherit;cursor:pointer}.primary{background:#2563eb;color:#fff;font-weight:600}.refresh{background:transparent;color:#64748b;margin-top:16px;padding:8px 0;font-size:12px}button:disabled{opacity:.5;cursor:default}.error{padding:12px;background:#fff0f2;color:#be123c;border:1px solid #fecdd3;border-radius:8px}input:focus-visible,button:focus-visible{outline:2px solid #9cb7ff;outline-offset:2px}</style>
