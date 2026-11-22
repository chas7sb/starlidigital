/** Follow rendered chat growth without treating that growth as user scroll intent. */
export function followChatScroll(node:HTMLElement,options:{enabled:()=>boolean;onChange:(value:boolean)=>void}){
 let current=options,lastTop=node.scrollTop,frame:number|null=null;
 const schedule=()=>{
  if(frame!==null)return;
  frame=requestAnimationFrame(()=>{
   frame=null;
   if(current.enabled()){node.scrollTop=node.scrollHeight;lastTop=node.scrollTop;}
  });
 };
 const scroll=()=>{
  const top=node.scrollTop,nearBottom=node.scrollHeight-node.clientHeight-top<=50;
  if(nearBottom)current.onChange(true);
  else if(top<lastTop-1)current.onChange(false);
  // Appending content can increase scrollHeight without moving scrollTop.
  // That must not turn off follow mode.
  lastTop=top;
 };
 const wheel=(event:WheelEvent)=>{if(event.deltaY<0&&node.scrollHeight>node.clientHeight)current.onChange(false);};
 const key=(event:KeyboardEvent)=>{
  if((event.target as Element)?.closest?.('input,textarea,[contenteditable="true"]'))return;
  if(['ArrowUp','PageUp','Home'].includes(event.key)&&node.scrollHeight>node.clientHeight)current.onChange(false);
 };
 const resize=new ResizeObserver(schedule);resize.observe(node);
 if(node.firstElementChild)resize.observe(node.firstElementChild);
 const mutation=new MutationObserver(schedule);mutation.observe(node,{subtree:true,childList:true,characterData:true,attributes:true});
 node.addEventListener('scroll',scroll,{passive:true});node.addEventListener('wheel',wheel,{passive:true});node.addEventListener('keydown',key);node.addEventListener('load',schedule,true);
 schedule();
 return {
  update(value:typeof options){current=value;if(current.enabled())schedule();},
  destroy(){if(frame!==null)cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();node.removeEventListener('scroll',scroll);node.removeEventListener('wheel',wheel);node.removeEventListener('keydown',key);node.removeEventListener('load',schedule,true);}
 };
}
