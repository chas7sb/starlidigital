export const shells=['round','soft-square','hex','helmet','capsule','pixel'] as const;
export const faces=['friendly','open','visor','focused','cute','minimal','pilot','screen'] as const;
export const eyes=['dots','round','pixel','sleepy','visor','spark'] as const;
export const mouths=['smile','tiny','flat','open','none'] as const;
export const accessories=['none','antenna','ears','headphones','crown','bolts','halo'] as const;
export const gradients=['diagonal','vertical','radial','horizontal'] as const;
export const backgrounds=['soft','ring','none'] as const;
export const palettes=[
  {name:'Atlas blue',a:'#2563eb',b:'#83b2ff'},
  {name:'Agata violet',a:'#8b5cf6',b:'#c4a2ff'},
  {name:'Nova ocean',a:'#0891b2',b:'#68e6ee'},
  {name:'Kiro orange',a:'#d97706',b:'#f7b75b'},
  {name:'Mira rose',a:'#db477b',b:'#ff9dbb'},
  {name:'Ledger mint',a:'#0d9488',b:'#54dcc1'},
  {name:'Pixel indigo',a:'#6366f1',b:'#a5a4ff'},
  {name:'Midnight',a:'#273b85',b:'#7d89ee'},
  {name:'Neon green',a:'#16a34a',b:'#bef264'},
  {name:'Coral',a:'#f06459',b:'#ffc3a0'},
  {name:'Amethyst',a:'#7339cd',b:'#f0a5fb'},
  {name:'Silver',a:'#65758c',b:'#d2d9e5'}
] as const;

export type Shell=typeof shells[number];
export type Face=typeof faces[number];
export type Eyes=typeof eyes[number];
export type Mouth=typeof mouths[number];
export type Accessory=typeof accessories[number];
export type Gradient=typeof gradients[number];
export type Background=typeof backgrounds[number];
export type AvatarConfig={shell:Shell;face:Face;eyes:Eyes;mouth:Mouth;accessory:Accessory;colorA:string;colorB:string;gradient:Gradient;background:Background};
export type PresetName='atlas'|'agata'|'nova'|'kiro'|'mira'|'ledger'|'pixel';
export const presetNames=['atlas','agata','nova','kiro','mira','ledger','pixel'] as const;

export const presets:Record<PresetName,AvatarConfig>={
 atlas:{shell:'round',face:'friendly',eyes:'dots',mouth:'smile',accessory:'antenna',colorA:'#2563eb',colorB:'#83b2ff',gradient:'diagonal',background:'soft'},
 agata:{shell:'soft-square',face:'cute',eyes:'round',mouth:'tiny',accessory:'ears',colorA:'#8b5cf6',colorB:'#c4a2ff',gradient:'diagonal',background:'soft'},
 nova:{shell:'capsule',face:'open',eyes:'round',mouth:'smile',accessory:'none',colorA:'#0891b2',colorB:'#68e6ee',gradient:'vertical',background:'soft'},
 kiro:{shell:'hex',face:'focused',eyes:'pixel',mouth:'flat',accessory:'none',colorA:'#d97706',colorB:'#f7b75b',gradient:'diagonal',background:'soft'},
 mira:{shell:'round',face:'cute',eyes:'dots',mouth:'smile',accessory:'headphones',colorA:'#db477b',colorB:'#ff9dbb',gradient:'radial',background:'soft'},
 ledger:{shell:'helmet',face:'screen',eyes:'visor',mouth:'tiny',accessory:'bolts',colorA:'#0d9488',colorB:'#54dcc1',gradient:'vertical',background:'soft'},
 pixel:{shell:'pixel',face:'screen',eyes:'pixel',mouth:'tiny',accessory:'antenna',colorA:'#6366f1',colorB:'#a5a4ff',gradient:'diagonal',background:'soft'}
};
const hex=/^#[0-9a-fA-F]{6}$/;
function member<T extends string>(allowed:readonly T[],value:unknown,fallback:T):T{return typeof value==='string'&&allowed.includes(value as T)?value as T:fallback;}
function color(value:unknown,fallback:string):string{return typeof value==='string'&&hex.test(value)?value.toLowerCase():fallback;}
export function normalizeAvatar(value:unknown,fallback:AvatarConfig=presets.atlas):AvatarConfig{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return {shell:member(shells,v.shell,fallback.shell),face:member(faces,v.face,fallback.face),eyes:member(eyes,v.eyes,fallback.eyes),mouth:member(mouths,v.mouth,fallback.mouth),accessory:member(accessories,v.accessory,fallback.accessory),colorA:color(v.colorA,fallback.colorA),colorB:color(v.colorB,fallback.colorB),gradient:member(gradients,v.gradient,fallback.gradient),background:member(backgrounds,v.background,fallback.background)};
}
export const CUSTOM_PREFIX='custom:v1:';
export function encodeAvatar(value:AvatarConfig):string{
 const v=normalizeAvatar(value);
 return CUSTOM_PREFIX+[v.shell,v.face,v.eyes,v.mouth,v.accessory,v.colorA.slice(1),v.colorB.slice(1),v.gradient,v.background].join('.');
}
export function decodeAvatar(value:unknown):AvatarConfig|null{
 if(typeof value!=='string'||!value.startsWith(CUSTOM_PREFIX)||value.length>175)return null;
 const items=value.slice(CUSTOM_PREFIX.length).split('.');
 if(items.length!==9)return null;
 const [shell,face,eye,mouth,accessory,a,b,gradient,background]=items;
 if(!shells.includes(shell as Shell)||!faces.includes(face as Face)||!eyes.includes(eye as Eyes)||!mouths.includes(mouth as Mouth)||!accessories.includes(accessory as Accessory)||!gradients.includes(gradient as Gradient)||!backgrounds.includes(background as Background)||!/^[0-9a-fA-F]{6}$/.test(a)||!/^[0-9a-fA-F]{6}$/.test(b))return null;
 return {shell:shell as Shell,face:face as Face,eyes:eye as Eyes,mouth:mouth as Mouth,accessory:accessory as Accessory,colorA:'#'+a.toLowerCase(),colorB:'#'+b.toLowerCase(),gradient:gradient as Gradient,background:background as Background};
}
export function isAllowedAvatarKey(value:unknown):value is string{
 return typeof value==='string'&&(presetNames.includes(value.replace(/^preset:/,'') as PresetName)||decodeAvatar(value)!==null);
}
export function presetKey(value:unknown):PresetName|null{
 if(typeof value!=='string')return null;
 const key=value.replace(/^preset:/,'');
 return presetNames.includes(key as PresetName)?key as PresetName:null;
}
export function getAvatar(value:unknown,name='',index=0):AvatarConfig{
 const parsed=decodeAvatar(value);
 if(parsed)return parsed;
 const preset=presetKey(value)||presetKey(name.toLowerCase().trim())||presetNames[Math.abs(index)%presetNames.length];
 return presets[preset];
}
export function randomAvatar(random:()=>number=Math.random):AvatarConfig{
 const pick=<T,>(values:readonly T[]):T=>values[Math.max(0,Math.min(values.length-1,Math.floor(random()*values.length)))];
 const palette=pick(palettes);
 return {shell:pick(shells),face:pick(faces),eyes:pick(eyes),mouth:pick(mouths),accessory:pick(accessories),colorA:palette.a,colorB:palette.b,gradient:pick(gradients),background:pick(backgrounds)};
}
export function avatarHash(value:string){
 let h=2166136261;
 for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(36);
}
export const templateCount=shells.length*faces.length*eyes.length*mouths.length*accessories.length*gradients.length*backgrounds.length;
