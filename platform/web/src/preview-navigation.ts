export type PreviewNavigation={path:string;hash:string};
const paths=new Set(['/','/despre','/servicii','/contact']);
export function readPreviewNavigation(event:{source:unknown;origin:string;data:unknown},expectedSource:unknown):PreviewNavigation|null{
 if(!expectedSource||event.source!==expectedSource||event.origin!=='null'||!event.data||typeof event.data!=='object')return null;
 const data=event.data as Record<string,unknown>;if(data.type!=='STARLI_PREVIEW_NAVIGATE'||typeof data.path!=='string'||typeof data.hash!=='string'||!paths.has(data.path)||data.hash.length>256||!/^#[^\u0000-\u0020]*$|^$/.test(data.hash))return null;
 return {path:data.path,hash:data.hash};
}
export const PREVIEW_NAVIGATION_SCRIPT=`(function(){
 const path=document.body.getAttribute('data-starli-preview-path')||'/';const initialHash=document.body.getAttribute('data-starli-preview-hash')||'';
 function scroll(hash){try{const el=document.getElementById(decodeURIComponent(hash.slice(1)));if(el)el.scrollIntoView({behavior:'smooth'});}catch{}}
 if(initialHash)setTimeout(function(){scroll(initialHash);},0);
 document.addEventListener('click',function(e){
  const link=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!link)return;
  e.preventDefault();e.stopPropagation();const href=link.getAttribute('href')||'';
  if(href.length>1024)return;
  try{
   const url=new URL(href,'https://starli-preview.invalid'+(path==='/'?'/':path+'/'));
   if(url.origin!=='https://starli-preview.invalid'){window.parent.postMessage({type:'STARLI_PREVIEW_EXTERNAL'},'*');return;}
   const next=url.pathname.replace(/\\/$/,'')||'/';
   if(next===path&&url.hash){scroll(url.hash);return;}
   window.parent.postMessage({type:'STARLI_PREVIEW_NAVIGATE',path:next,hash:url.hash},'*');
  }catch{}
 },true);
 document.addEventListener('submit',function(e){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:'STARLI_PREVIEW_FORM'},'*');},true);
})();`;
export const PREVIEW_SELECTION_SCRIPT=`
(function(){
  let hovered = null;
  let selected = null;
  const style = document.createElement('style');
  style.textContent = \`
    [data-starli-hover] { outline: 1.5px dashed #8bb9e8 !important; outline-offset: 2px !important; cursor: pointer !important; }
    [data-starli-selected] { outline: 2px solid #bbdcf9 !important; outline-offset: 3px !important; background-color: rgba(187, 220, 249, 0.06) !important; }
  \`;
  document.head.appendChild(style);
  function describe(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 140);
    return { tag, selector: tag + id + cls, text };
  }
  document.addEventListener('mouseover', function(e) {
    const el = e.target;
    if (hovered && hovered !== el) hovered.removeAttribute('data-starli-hover');
    if (el && el !== document.body && el !== document.documentElement) {
      hovered = el;
      hovered.setAttribute('data-starli-hover', 'true');
    }
  }, true);
  document.addEventListener('mouseout', function(e) {
    if (hovered) { hovered.removeAttribute('data-starli-hover'); hovered = null; }
  }, true);
  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (selected) selected.removeAttribute('data-starli-selected');
    selected = el;
    if (selected && selected !== document.body && selected !== document.documentElement) {
      selected.setAttribute('data-starli-selected', 'true');
      const info = describe(selected);
      if (info) window.parent.postMessage({ type: 'STARLI_ELEMENT_SELECTED', payload: info }, '*');
    }
  }, true);
})();
`;
export function buildNavigablePreview(rawHtml:string|null|undefined,selectMode:boolean,path='/',hash=''):string{
 if(!rawHtml)return '';
 const nonce='starli-preview-bridge';
 // Execute only the fixed editor bridge, never scripts carried by generated documents.
 let html=rawHtml.replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi,'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');
 html=html.replace(/script-src\s+[^;"<>]*/gi,`script-src 'nonce-${nonce}'`);
 const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const attributes=` data-starli-preview-path="${escape(path)}" data-starli-preview-hash="${escape(hash)}"`;
 html=html.replace(/<body\b([^>]*)>/i,(_,attributesBefore:string)=>'<body'+attributesBefore.replace(/\sdata-starli-preview-(?:path|hash)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')+attributes+'>');
 const script=selectMode?PREVIEW_SELECTION_SCRIPT:PREVIEW_NAVIGATION_SCRIPT;
 const bridge=`<script nonce="${nonce}">${script}</script>`;
 return /<\/body>/i.test(html)?html.replace(/<\/body>/i,bridge+'</body>'):html+bridge;
}
