export function csvPreview(source:string,maxRows=100,maxColumns=30){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,malformed=false,total=0,columns=0;
 function field(){if(row.length<maxColumns)row.push(cell);cell='';}
 function record(){field();columns=Math.max(columns,row.length);total++;if(rows.length<=maxRows)rows.push(row);row=[];}
 for(let i=0;i<source.length;i++){const char=source[i];if(char==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else cell+=char;}else if(char===','&&!quoted)field();else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&source[i+1]==='\n')i++;record();}else cell+=char;}
 if(cell!==''||row.length||source.length&&!/[\r\n]$/.test(source))record();if(quoted)malformed=true;
 return {headers:rows[0]||[],rows:rows.slice(1),totalRows:Math.max(0,total-1),columns,truncated:total>maxRows+1,malformed};
}
export function artifactLanguage(value:string){const raw=(value||'').trim().split(/\s+/)[0].toLowerCase();return ({js:'javascript',mjs:'javascript',cjs:'javascript',py:'python',ts:'typescript',sh:'bash',yml:'yaml',html:'xml'} as Record<string,string>)[raw]||raw||'text';}
export function artifactFilename(language:string,index=1){const extension=({javascript:'js',typescript:'ts',python:'py',csv:'csv',json:'json',bash:'sh',xml:'html',css:'css',sql:'sql',yaml:'yaml'} as Record<string,string>)[language]||'txt';return 'artifact-'+index+'.'+extension;}
export function downloadArtifact(code:string,filename:string){const url=URL.createObjectURL(new Blob([code],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
