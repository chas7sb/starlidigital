import type { BrandProfileRecord } from '../video/types.js';
import type { StoryboardScene, VideoVariantPlan } from './types.js';

const textLayer = (id: string, text: string, x: number, y: number, width: number, fontSize: number, color: string, align: 'left'|'center' = 'center', effect = 'fade') => ({
  id, type: 'text', text, x, y, width, anchor: align === 'center' ? 'top_center' : 'top_left', align, fontSize, fontWeight: 'semibold', color, lineHeight: 1.1, textEffect: effect,
});

export function compileScene(scene: StoryboardScene, variant: VideoVariantPlan, brand: BrandProfileRecord | undefined): any {
  const { width: w, height: h, safeArea } = variant;
  const left = safeArea.left, right = w - safeArea.right, top = safeArea.top, bottom = h - safeArea.bottom;
  const contentW = right - left;
  const centerX = w / 2;
  const fg = brand?.textColor || '#F4F6FA', accent = brand?.accentColor || '#C6DBF0', bg = brand?.primaryColor || '#080C12';
  const vertical = variant.layoutProfile === 'VERTICAL';
  const titleSize = vertical ? 76 : variant.layoutProfile === 'SQUARE' ? 66 : 72;
  const bodySize = vertical ? 40 : 34;
  const imageReq = scene.assetRequirements.find(r => r.assetId);
  const layers: any[] = [];
  const addTitle = (y = top + Math.round((bottom-top)*0.16), effect='slide_up') => layers.push(textLayer(`${scene.id}-title`, scene.headline, centerX, y, Math.round(contentW * .9), titleSize, fg, 'center', effect));

  switch (scene.template) {
    case 'HOOK_TITLE': case 'KINETIC_TYPOGRAPHY':
      addTitle(top + Math.round((bottom-top)*0.33), scene.template === 'KINETIC_TYPOGRAPHY' ? 'word_reveal' : 'blur_in'); break;
    case 'PRODUCT_SCREENSHOT': case 'APP_MOCKUP': case 'WEBSITE_SHOWCASE':
      addTitle(top + 30);
      if (imageReq?.assetId) layers.push({ id:`${scene.id}-asset`, type:'image', assetId:imageReq.assetId, x:centerX, y:top + Math.round((bottom-top)*.58), width:Math.round(contentW*(vertical?.88:.68)), height:Math.round((bottom-top)*(vertical?.52:.64)), anchor:'center', fit:'contain', imageEffect:'slow_zoom_in' });
      break;
    case 'STAT_METRIC':
      layers.push(textLayer(`${scene.id}-metric`, scene.metric?.value || scene.headline, centerX, top + Math.round((bottom-top)*.30), Math.round(contentW*.9), titleSize+36, accent, 'center', 'word_reveal'));
      layers.push(textLayer(`${scene.id}-label`, scene.metric?.label || scene.body || '', centerX, top + Math.round((bottom-top)*.55), Math.round(contentW*.82), bodySize, fg)); break;
    case 'TESTIMONIAL_QUOTE':
      layers.push({ id:`${scene.id}-card`, type:'ui', component:'glass_card', x:centerX, y:top + Math.round((bottom-top)*.5), width:Math.round(contentW*.9), height:Math.round((bottom-top)*.52), anchor:'center', theme:'obsidian' });
      layers.push(textLayer(`${scene.id}-quote`, `“${scene.quote?.text || scene.headline}”`, centerX, top + Math.round((bottom-top)*.34), Math.round(contentW*.76), bodySize+8, fg));
      if (scene.quote?.attribution) layers.push(textLayer(`${scene.id}-attr`, scene.quote.attribution, centerX, top + Math.round((bottom-top)*.65), Math.round(contentW*.7), bodySize-6, accent)); break;
    case 'BEFORE_AFTER':
      addTitle(top + 20); layers.push({id:`${scene.id}-left`,type:'ui',component:'glass_card',x:left,y:top+Math.round((bottom-top)*.35),width:Math.round(contentW*.46),height:Math.round((bottom-top)*.42),anchor:'top_left',componentProps:{title:'Before'}}); layers.push({id:`${scene.id}-right`,type:'ui',component:'glass_card',x:right-Math.round(contentW*.46),y:top+Math.round((bottom-top)*.35),width:Math.round(contentW*.46),height:Math.round((bottom-top)*.42),anchor:'top_left',componentProps:{title:'After'}}); break;
    case 'CTA_END_CARD': case 'LOGO_BRAND_MOMENT':
      addTitle(top + Math.round((bottom-top)*.28), 'fade'); if (scene.body) layers.push(textLayer(`${scene.id}-body`, scene.body, centerX, top+Math.round((bottom-top)*.52), Math.round(contentW*.8), bodySize, accent)); break;
    default:
      addTitle(top + 30); if (scene.body) layers.push(textLayer(`${scene.id}-body`, scene.body, centerX, top+Math.round((bottom-top)*.40), Math.round(contentW*.84), bodySize, fg));
  }
  return { id: scene.id, duration: scene.duration, background: { type:'color', color:bg }, transition:{ type:'crossfade', duration:Math.min(.4, scene.duration/4) }, layers };
}
