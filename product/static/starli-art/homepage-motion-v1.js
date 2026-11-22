/* Live StarliDigital homepage pools, scoped SPA lifecycle. No company data/API access. */
(() => {
 'use strict';
 const state=window.__starliHomepageMotionV1={version:'v1-r6',initialized:false,cycles:0,paused:false,start};
  const avatars=Array.from({length:48},(_,i)=>'/starli-art/avatars/custom-'+String(i+1).padStart(2,'0')+'.svg');
  const names=[
    'Echo','Luna','Rex','Astra','Zeno','Iris','Cleo','Ollie','Lyra','Orion',
    'Finn','Vela','Juno','Milo','Aurora','Pax','Indigo','Vivi','Nico','Aria',
    'Cosmo','Tess','Novae','Koda','Rumi','Sol','Kira','Kai','Arlo','Uma',
    'Nina','Ember','Quinn','Zara','Robin','Vega','Nori','Atlasia','Sora','Theo',
    'Riley','Cora','Faye','Nox','Remy','Eden','Bex','Mirae','Rio','Taro',
    'Ellis','Cyan','Sky','Tavi','Aiko','Zephyr','Pixelia','Tula','Mika','Vale'
  ];
  const roles=['Coordinator','Marketing','Research','Developer','Operations','Finance','Design',
    'Customer support','Automation','Scheduling','Data analyst','Sales'];

 function start(root){
  if(!root||location.pathname!=='/')return ()=>{};
  const list=root.querySelector('ul[aria-label="Illustrative AI team roles"]');
  if(!list)return ()=>{};
  let disposed=false,transitionTimer=null;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const cards=()=>Array.from(list.querySelectorAll(':scope > li:not(.custom-bot)')).filter(li=>!li.querySelector('button,input,textarea,form'));
  const pick=(values,n)=>{const copy=[...values];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy.slice(0,n);};
  let avatarQueue=[];
  const nextAvatars=(count)=>{
   const chosen=[];
   while(chosen.length<count){
    if(!avatarQueue.length)avatarQueue=pick(avatars,avatars.length);
    chosen.push(avatarQueue.pop());
   }
   return chosen;
  };
  function decorate(){
   for(const li of cards()){
    li.dataset.starliRotator='v1';
    const character=li.querySelector('.character');
    if(!character||character.querySelector('img.starli-rotator-avatar'))continue;
    const img=document.createElement('img');img.className='starli-rotator-avatar';img.alt='';
    img.setAttribute('aria-hidden','true');img.src=nextAvatars(1)[0];character.appendChild(img);
   }
  }
  function cycle(){
   if(disposed||!root.isConnected||document.hidden||location.pathname!=='/'||state.paused)return;
   const entries=cards();if(!entries.length)return;
   const chosenNames=pick(names,entries.length),chosenRoles=pick(roles,entries.length),chosenAvatars=nextAvatars(entries.length);
   if(!reduced.matches)entries.forEach(li=>li.classList.add('starli-cycle-out'));
   clearTimeout(transitionTimer);
   transitionTimer=setTimeout(()=>{
    transitionTimer=null;if(disposed||!root.isConnected||state.paused){entries.forEach(li=>li.classList.remove('starli-cycle-out'));return;}
    entries.forEach((li,i)=>{
     if(!li.isConnected)return;
     const image=li.querySelector('img.starli-rotator-avatar');if(image)image.src=chosenAvatars[i];
     const name=li.querySelector('strong'),role=li.querySelector('small');
     if(name)name.textContent=chosenNames[i];if(role)role.textContent=chosenRoles[i];
     li.classList.remove('starli-cycle-out');
    });state.cycles++;
   },reduced.matches?0:190);
  }
  decorate();state.initialized=true;
  const observer=new MutationObserver(decorate);observer.observe(list,{childList:true,subtree:false});
  const interval=setInterval(cycle,2600);
  const visible=()=>{if(!document.hidden&&!disposed)decorate();};
  const motionChanged=()=>{if(reduced.matches){clearTimeout(transitionTimer);transitionTimer=null;cards().forEach(li=>li.classList.remove('starli-cycle-out'));}};
  document.addEventListener('visibilitychange',visible);
  reduced.addEventListener('change',motionChanged);
  return ()=>{
   if(disposed)return;disposed=true;clearInterval(interval);clearTimeout(transitionTimer);
   observer.disconnect();document.removeEventListener('visibilitychange',visible);reduced.removeEventListener('change',motionChanged);
   cards().forEach(li=>li.classList.remove('starli-cycle-out'));state.initialized=false;
  };
 }
})();
