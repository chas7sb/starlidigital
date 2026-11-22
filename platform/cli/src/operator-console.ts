import {EventEmitter} from 'node:events';
import {stdin,stdout} from 'node:process';
import {StringDecoder} from 'node:string_decoder';
type Input=Pick<typeof stdin,'on'|'off'|'resume'|'pause'|'isRaw'|'setRawMode'>;
type Output=Pick<typeof stdout,'write'|'on'|'off'|'columns'|'rows'>;

export const cleanTerminal=(text:string)=>text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').replace(/\t/g,'  ');
export function consoleLines(text:string,width:number){const size=Math.max(1,width);return cleanTerminal(text).split('\n').flatMap(line=>{const chars=Array.from(line);return chars.length?Array.from({length:Math.ceil(chars.length/size)},(_,i)=>chars.slice(i*size,(i+1)*size).join('')):[''];});}

/** A bounded alternate-screen terminal; input and activity are separate from receipts. */
export class OperatorConsole extends EventEmitter implements AsyncIterable<string>{
 private entries:string[]=[];private input='';private cursor=0;private queue:string[]=[];private waiter?:()=>void;private ended=false;
 private activity='Pregătit';private context='Conversație nouă';private began=Date.now();private timer:ReturnType<typeof setInterval>;private previousRaw=false;private decoder=new StringDecoder('utf8');private history:string[]=[];private historyIndex=0;private paste=false;private escapeBuffer='';private scroll=0;
 constructor(private source:Input=stdin,private sink:Output=stdout){super();this.previousRaw=Boolean(source.isRaw);this.sink.write('\x1b[?1049h\x1b[?2004h');this.source.setRawMode(true);this.source.resume();this.source.on('data',this.onData);this.sink.on('resize',this.render);this.timer=setInterval(this.render,1000);this.timer.unref();this.render();}
 get line(){return this.input;}
 setPrompt(_prompt:string){}prompt(_preserve?:boolean){this.render();}
 setInput(text:string){this.input=cleanTerminal(text);this.cursor=this.input.length;this.render();}
 setContext(text:string){this.context=cleanTerminal(text);this.render();}
 setActivity(text:string){this.activity=cleanTerminal(text);this.render();}
 write(text:string){this.entries.push(cleanTerminal(text));if(this.entries.length>400)this.entries.splice(0,this.entries.length-400);this.scroll=0;this.render();}
 close(){if(this.ended)return;this.ended=true;clearInterval(this.timer);this.source.off('data',this.onData);this.sink.off('resize',this.render);this.source.setRawMode(this.previousRaw);this.source.pause();this.sink.write('\x1b[?2004l\x1b[?25h\x1b[?1049l');this.waiter?.();}
 private insert(text:string){this.input=this.input.slice(0,this.cursor)+text+this.input.slice(this.cursor);this.cursor+=text.length;}
 private submit(){const line=this.input;if(line.trim()){this.history.push(line);this.history=this.history.slice(-100);}this.historyIndex=this.history.length;this.input='';this.cursor=0;this.queue.push(line);this.waiter?.();this.waiter=undefined;}
 private onData=(data:Buffer)=>{
  this.escapeBuffer+=this.decoder.write(data);
  while(this.escapeBuffer){
   if(this.paste){const end=this.escapeBuffer.indexOf('\x1b[201~');if(end<0){if(this.escapeBuffer.length>6){this.insert(cleanTerminal(this.escapeBuffer.slice(0,-6)).replace(/\r\n?/g,'\n'));this.escapeBuffer=this.escapeBuffer.slice(-6);}break;}this.insert(cleanTerminal(this.escapeBuffer.slice(0,end)).replace(/\r\n?/g,'\n'));this.escapeBuffer=this.escapeBuffer.slice(end+6);this.paste=false;continue;}
   const sequences=['\x1b[200~','\x1b[A','\x1b[B','\x1b[C','\x1b[D','\x1b[H','\x1b[F','\x1b[3~','\x1b[5~','\x1b[6~','\x1b\r'];
   const key=sequences.find(value=>this.escapeBuffer.startsWith(value));
   if(!key&&this.escapeBuffer.startsWith('\x1b')&&sequences.some(value=>value.startsWith(this.escapeBuffer)))break;
   const char=key||Array.from(this.escapeBuffer)[0];this.escapeBuffer=this.escapeBuffer.slice(char.length);
   if(char==='\x1b[200~')this.paste=true;
   else if(char==='\x03')this.emit('SIGINT');
   else if(char==='\x04'){if(!this.input)this.close();}
   else if(char==='\r'||char==='\n')this.submit();
   else if(char==='\x1b\r')this.insert('\n');
   else if(char==='\x7f'||char==='\b'){if(this.cursor){this.input=this.input.slice(0,this.cursor-1)+this.input.slice(this.cursor);this.cursor--;}}
   else if(char==='\x1b[3~')this.input=this.input.slice(0,this.cursor)+this.input.slice(this.cursor+1);
   else if(char==='\x1b[D')this.cursor=Math.max(0,this.cursor-1);
   else if(char==='\x1b[C')this.cursor=Math.min(this.input.length,this.cursor+1);
   else if(char==='\x01'||char==='\x1b[H')this.cursor=0;
   else if(char==='\x05'||char==='\x1b[F')this.cursor=this.input.length;
   else if(char==='\x15'){this.input=this.input.slice(this.cursor);this.cursor=0;}
   else if(char==='\x1b[A'||char==='\x1b[B'){this.historyIndex=Math.max(0,Math.min(this.history.length,this.historyIndex+(char==='\x1b[A'?-1:1)));this.input=this.history[this.historyIndex]||'';this.cursor=this.input.length;}
   else if(char==='\x1b[5~')this.scroll+=10;
   else if(char==='\x1b[6~')this.scroll=Math.max(0,this.scroll-10);
   else if(char==='\x0c')this.scroll=0;
   else if(char>=' '&&!char.startsWith('\x1b'))this.insert(char);
  }this.render();
 };
 private render=()=>{
  if(this.ended)return;const width=Math.max(1,(this.sink.columns||80)-1),height=Math.max(1,this.sink.rows||24),clip=(text:string)=>Array.from(text).slice(0,width).join('');
  if(height<8||width<12){this.sink.write('\x1b[H'+clip('STARLI · '+this.activity)+'\x1b[K\x1b[J');return;}
  const logs=this.entries.flatMap(text=>consoleLines(text,width)),capacity=height-6;this.scroll=Math.min(this.scroll,Math.max(0,logs.length-capacity));const end=logs.length-this.scroll,visible=logs.slice(Math.max(0,end-capacity),end);
  const elapsed=Math.floor((Date.now()-this.began)/1000),label=`STARLI  ·  ${this.context}`;
  const input=this.input.replace(/\n/g,' ↵ '),before=this.input.slice(0,this.cursor).replace(/\n/g,' ↵ '),offset=Math.max(0,Array.from(before).length-width+5),shown=Array.from(input).slice(offset,offset+width-3).join('');
  const lines=[clip(label),'─'.repeat(width),...visible,...Array(Math.max(0,capacity-visible.length)).fill(''),clip(`● ${this.activity}`),clip(`${Math.floor(elapsed/60)}m ${elapsed%60}s · /help · /stop · PgUp istoric · Ctrl+C oprește`),clip('› '+shown),clip(this.input.includes('\n')?'Text pe mai multe linii · Enter trimite tot · Alt+Enter rând nou':'Enter trimite · ↑↓ istoric · /paste pentru text lung')];
  this.sink.write('\x1b[?25l\x1b[H'+lines.map(line=>line+'\x1b[K').join('\r\n')+'\x1b[J'+`\x1b[${height-1};${Math.min(width,3+Array.from(before).length-offset)}H\x1b[?25h`);
 };
 async *[Symbol.asyncIterator](){while(!this.ended){if(!this.queue.length)await new Promise<void>(resolve=>this.waiter=resolve);while(this.queue.length)yield this.queue.shift()!;}}
}
