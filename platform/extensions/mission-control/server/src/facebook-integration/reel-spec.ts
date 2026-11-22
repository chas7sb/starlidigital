import {z} from 'zod';

const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const seconds=z.number().min(0).max(60);
const animation=z.object({
 property:z.enum(['opacity','x','y','scale']),
 fromValue:z.number().min(-1920).max(1920),toValue:z.number().min(-1920).max(1920),
 start:seconds.optional(),duration:z.number().min(0.1).max(60),
 easing:z.enum(['linear','easeIn','easeOut','easeInOut','easeOutCubic','easeInOutCubic']).optional(),
}).strict();
const textLayer=z.object({
 text:z.string().trim().min(1).max(240),x:z.number().min(0).max(540),y:z.number().min(0).max(960),
 fontSize:z.number().int().min(12).max(100),color:color.optional(),
 anchor:z.enum(['top_left','center','top_center']).optional(),
 align:z.enum(['left','center','right']).optional(),
 effect:z.enum(['none','fade','slide_up','typewriter','word_reveal']).optional(),
 start:seconds.optional(),duration:z.number().min(0.1).max(60).optional(),
 animations:z.array(animation).max(6).optional(),
}).strict();
const scene=z.object({
 duration:z.number().min(1).max(60),backgroundColor:color.optional(),
 transition:z.object({type:z.enum(['none','crossfade','dip_to_black','slide_left','slide_right']),
  duration:z.number().min(0).max(2)}).strict().optional(),
 text:z.array(textLayer).min(1).max(6),
}).strict();
export const customerReelSpec=z.object({
 duration:z.number().min(4).max(60),scenes:z.array(scene).min(1).max(10),
 audio:z.object({
  music:z.object({style:z.literal('cosmic_pad'),volume:z.number().min(0).max(0.5)}).strict().optional(),
  voiceovers:z.array(z.object({
   text:z.string().trim().min(1).max(500),
   voice:z.enum(['en-US-JennyNeural','en-US-GuyNeural','ro-RO-AlinaNeural','ro-RO-EmilNeural']),
   start:seconds,
  }).strict()).max(4).optional(),
 }).strict().optional(),
}).strict();

export function compileCustomerReelSpec(raw:z.infer<typeof customerReelSpec>){
 const spec=customerReelSpec.parse(raw);
 const duration=spec.scenes.reduce((sum,scene)=>sum+scene.duration,0);
 if(Math.abs(duration-spec.duration)>0.001)throw Error('REEL_SCENE_DURATION_MISMATCH');
 for(const [index,scene] of spec.scenes.entries()){
  if((scene.transition?.duration??0)>Math.min(scene.duration,spec.scenes[index-1]?.duration??0))
   throw Error('REEL_TRANSITION_OUTSIDE_SCENE');
  for(const text of scene.text){
   const start=text.start??0,end=start+(text.duration??scene.duration-start);
   if(start>=scene.duration||end>scene.duration+0.001)throw Error('REEL_TEXT_OUTSIDE_SCENE');
   for(const anim of text.animations??[]){
    const values=[anim.fromValue,anim.toValue];
    if((anim.start??0)+anim.duration>end-start+0.001||
     (anim.property==='opacity'&&values.some(v=>v<0||v>1))||
     (anim.property==='scale'&&values.some(v=>v<0.1||v>3)))throw Error('REEL_ANIMATION_OUT_OF_BOUNDS');
   }
  }
 }
 if(spec.audio?.voiceovers?.some(vo=>vo.start>=duration))throw Error('REEL_VOICEOVER_OUTSIDE_TIMELINE');
 return {
  title:'Customer Reel',
  canvas:{width:540,height:960,fps:24,duration:spec.duration},
  scenes:spec.scenes.map(scene=>({duration:scene.duration,
   background:{type:'color',color:scene.backgroundColor??'#080C12'},
   transition:scene.transition??{type:'none',duration:0},
   layers:scene.text.map(({effect,...layer})=>({...layer,type:'text',textEffect:effect??'none'})),
  })),
  audioTracks:[{syntheticType:'cosmic_pad',volume:spec.audio?.music?.volume??0}],
  voiceovers:spec.audio?.voiceovers?.map(vo=>({...vo,language:vo.voice.startsWith('ro-')?'ro':'en'}))??[],
  output:{format:'mp4',codec:'h264',crf:23,preset:'fast'},
 };
}
