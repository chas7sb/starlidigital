import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]);}
const found=[];
const pattern = process.argv.includes('--ascii') ? /\b(?:Alege|Motiv|nu|Nu|pentru|sunt|Stare|Detalii|Creeaza|Salveaza|Rezervat|Titlu|Domeniu|sterge|Sterge|Contul|contul|Nume|Telefon|Solicitare|Buget|Verificat|Revocat|Activ|dispozitivul|Executa|Preferinte|Conectare|Adauga|Confirmare|Inapoi|Subiect|reincarca|fara|este|poate|proiectului|planul|Emailuri|Tokenuri|Sincronizare)\b/ : /[ăâîșțĂÂÎȘȚ]/;
for(const file of files('web/src').filter(file=>/\.tsx?$/.test(file)&&!file.endsWith('.test.ts'))){
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node){if((ts.isStringLiteralLike(node)||ts.isJsxText(node)||ts.isTemplateExpression(node))&&pattern.test(node.getText(source)))found.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,text:node.getText(source)});else ts.forEachChild(node,visit);}visit(source);
}
writeFileSync('output/private/ui-language-audit.json',JSON.stringify(found,null,2));
console.log(JSON.stringify(found.map(item=>({file:item.file,line:item.line,text:item.text.slice(0,350)})),null,2));
