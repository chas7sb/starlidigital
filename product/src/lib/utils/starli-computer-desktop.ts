export type ComputerDesktop={control(enabled:boolean):void;disconnect():void};
export type DesktopFactory=(target:HTMLElement,url:string,events:{connected():void;disconnected():void;error():void})=>ComputerDesktop;
export async function loadComputerDesktop():Promise<DesktopFactory>{
 const {default:RFB}=await import('../vendor/novnc-1.7.0/core/rfb.js');
 return (target,url,events)=>{
  const shell=document.createElement('div');shell.style.cssText='width:100%;height:100%;min-height:320px';target.appendChild(shell);
  const rfb=new RFB(shell,url,{shared:true,wsProtocols:['binary']});let disposed=false,failed=false;
  rfb.viewOnly=true;rfb.focusOnClick=false;rfb.scaleViewport=true;rfb.resizeSession=false;
  const fail=()=>{if(disposed||failed)return;failed=true;rfb.viewOnly=true;events.error();rfb.disconnect();};
  rfb.addEventListener('connect',()=>{if(!disposed)events.connected();});
  rfb.addEventListener('disconnect',()=>{if(!disposed)events.disconnected();});
  rfb.addEventListener('credentialsrequired',fail);rfb.addEventListener('securityfailure',fail);rfb.addEventListener('serververification',fail);
  return {control(enabled){if(disposed)return;rfb.viewOnly=!enabled;rfb.focusOnClick=enabled;if(enabled)rfb.focus();else rfb.blur();},disconnect(){if(disposed)return;disposed=true;rfb.viewOnly=true;try{rfb.disconnect();}catch{}shell.remove();}};
 };
}
