import ts from 'typescript';
import type { SourceFile } from './next-template.js';

/**
 * Deterministically compiles the generated Next.js / React TSX source files (`app/page.tsx`, `app/globals.css`,
 * and optional components `Navbar.tsx`, `Footer.tsx`) into a self-contained, sandboxed HTML preview document.
 *
 * This guarantees that every generated or edited website immediately has an accurate, multi-device visual preview
 * even when the isolated Docker worker is not enabled, and preserves the last known good preview when a later run fails.
 */
export function renderNextPreviewHtml(
  files: SourceFile[],
  options: { title?: string; description?: string; path?: string } = {}
): string {
  const started=performance.now();let operations=0;
  const check=()=>{if(++operations>30000||performance.now()-started>250)throw new Error('Previzualizarea a depășit limitele de complexitate. Simplifică componenta și reîncearcă.');};
  const join=(parts:Iterable<unknown>,separator='')=>{let result='';let first=true;for(const part of parts){check();const text=String(part??'');const extra=(first?'':separator)+text;if(result.length+extra.length>20000000)throw new Error('Previzualizarea depășește limita de dimensiune.');result+=extra;first=false;}return result;};
  const path=(options.path||'/').replace(/\/$/,'')||'/';
  if(!['/','/despre','/servicii','/contact'].includes(path))throw new Error('Pagina solicitată nu există în previzualizare.');
  const pagePath=path==='/'?'app/page.tsx':`app${path}/page.tsx`;
  const pageFile = files.find(f => f.path === pagePath);
  const cssFile = files.find(f => f.path === 'app/globals.css');
  const layoutFile = files.find(f => f.path === 'app/layout.tsx');

  if (!pageFile) {if(options.path)throw new Error('Pagina solicitată nu există în proiect.');return '';}

  let title = options.title || 'Preview Website';
  let description = options.description || '';
  for (const metadataFile of [layoutFile,pageFile]) {
    if(!metadataFile)continue;
    const titleMatch = metadataFile.content.match(/["']?title["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    if (titleMatch) {
      try { title = JSON.parse(titleMatch[1]); } catch { /* ignore */ }
    }
    const descMatch = metadataFile.content.match(/["']?description["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    if (descMatch) {
      try { description = JSON.parse(descMatch[1]); } catch { /* ignore */ }
    }
  }

  const assetMap = new Map<string, string>();
  for (const file of files) {
    if (file.encoding === 'base64' && file.path.startsWith('public/')) {
      const rel = file.path.replace(/^public\//, '');
      const dataUri = `data:image/png;base64,${file.content}`;
      assetMap.set(rel, dataUri);
      assetMap.set('/' + rel, dataUri);
      assetMap.set('./' + rel, dataUri);
    }
  }

  let css = cssFile?.content || '';
  for (const [assetPath, dataUri] of [...assetMap.entries()].sort((a,b)=>b[0].length-a[0].length)) {
    css = css.split(assetPath).join(dataUri);
  }
  const safeCss = css.replace(/<\/style/gi, '<\\/style');

  // Collect component definitions from optional components and app/page.tsx
  const navbarFile = files.find(f => f.path === 'components/Navbar.tsx');
  const footerFile = files.find(f => f.path === 'components/Footer.tsx');

  const bodyHtml = renderTsxFileToStaticMarkup(pageFile.content, {
    Navbar: navbarFile ? renderTsxFileToStaticMarkup(navbarFile.content, {}, assetMap,check,join) : '',
    Footer: footerFile ? renderTsxFileToStaticMarkup(footerFile.content, {}, assetMap,check,join) : ''
  }, assetMap,check,join);

  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

  return [
    '<!doctype html>',
    '<html lang="ro">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : '',
    `<style>${safeCss}</style>`,
    '</head>',
    `<body>${bodyHtml}</body>`,
    '</html>'
  ].filter(Boolean).reduce((out,part)=>join([out,part],'\n'),'');
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

type Env = Record<string, any>;

function renderTsxFileToStaticMarkup(
  code: string,
  externalComponents: Record<string, string>,
  assetMap: Map<string, string>,
  check:()=>void,
  join:(parts:Iterable<unknown>,separator?:string)=>string
): string {
  const source = ts.createSourceFile('preview.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const topConsts: Env = {};
  const components = new Map<string, ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression>();
  let defaultComponent: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null;

  // Pass 1: collect top-level constants and component functions
  for (const stmt of source.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const name = decl.name.text;
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            components.set(name, decl.initializer);
          } else {
            topConsts[name] = evalExpr(decl.initializer, topConsts);
          }
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      components.set(stmt.name.text, stmt);
      const isDefault = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault) defaultComponent = stmt;
    } else if (ts.isExportAssignment(stmt)) {
      if (ts.isIdentifier(stmt.expression) && components.has(stmt.expression.text)) {
        defaultComponent = components.get(stmt.expression.text)!;
      } else if (ts.isArrowFunction(stmt.expression) || ts.isFunctionExpression(stmt.expression)) {
        defaultComponent = stmt.expression;
      }
    }
  }

  if (!defaultComponent && components.size > 0) {
    defaultComponent = [...components.values()].at(-1)!;
  }

  function evalExpr(node: ts.Node | undefined, env: Env): any {
    check();
    if (!node) return '';
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) return null;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      return evalExpr(node.expression, env);
    }
    if (ts.isTemplateExpression(node)) {
      let out = node.head.text;
      for (const span of node.templateSpans) {
        const val = evalExpr(span.expression, env);
        out = join([out,val??'',span.literal.text]);
      }
      return out;
    }
    if (ts.isIdentifier(node)) {
      if (node.text in env) return env[node.text];
      if (node.text in topConsts) return topConsts[node.text];
      return '';
    }
    if (ts.isArrayLiteralExpression(node)) {
      const arr: any[] = [];
      for (const el of node.elements) {
        if (ts.isSpreadElement(el)) {
          const spreadVal = evalExpr(el.expression, env);
          if (Array.isArray(spreadVal)){if(arr.length+spreadVal.length>10000)throw new Error('Colecția din preview este prea mare.');arr.push(...spreadVal);}
        } else {
          if(arr.length>=10000)throw new Error('Colecția din preview este prea mare.');arr.push(evalExpr(el, env));
        }
      }
      return arr;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const obj: Record<string, any> = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
            ? prop.name.text
            : prop.name.getText(source);
          obj[key] = evalExpr(prop.initializer, env);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          obj[prop.name.text] = evalExpr(prop.name, env);
        } else if (ts.isSpreadAssignment(prop)) {
          const spreadObj = evalExpr(prop.expression, env);
          if (spreadObj && typeof spreadObj === 'object') Object.assign(obj, spreadObj);
        }
      }
      return obj;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = evalExpr(node.expression, env);
      if (target != null && typeof target === 'object') return target[node.name.text];
      return '';
    }
    if (ts.isElementAccessExpression(node)) {
      const target = evalExpr(node.expression, env);
      const index = evalExpr(node.argumentExpression, env);
      if (target != null && index != null) return target[index];
      return '';
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const val = evalExpr(node.operand, env);
      if (node.operator === ts.SyntaxKind.ExclamationToken) return !val;
      if (node.operator === ts.SyntaxKind.MinusToken) return -Number(val);
      return val;
    }
    if (ts.isBinaryExpression(node)) {
      const left = evalExpr(node.left, env);
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return left ? evalExpr(node.right, env) : '';
      }
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        return left ? left : evalExpr(node.right, env);
      }
      const right = evalExpr(node.right, env);
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return typeof left==='number'&&typeof right==='number'?left+right:join([left??'',right??'']);
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken: return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken: return left !== right;
        case ts.SyntaxKind.GreaterThanToken: return left > right;
        case ts.SyntaxKind.LessThanToken: return left < right;
        default: return left;
      }
    }
    if (ts.isConditionalExpression(node)) {
      const cond = evalExpr(node.condition, env);
      return cond ? evalExpr(node.whenTrue, env) : evalExpr(node.whenFalse, env);
    }
    if (ts.isCallExpression(node)) {
      // Handle useState(initialValue) -> [initialValue, noop]
      if (ts.isIdentifier(node.expression) && node.expression.text === 'useState') {
        const initVal = node.arguments[0] ? evalExpr(node.arguments[0], env) : undefined;
        return [initVal, () => {}];
      }
      // Handle array.map / array.slice / array.filter / array.join
      if (ts.isPropertyAccessExpression(node.expression)) {
        const target = evalExpr(node.expression.expression, env);
        const method = node.expression.name.text;
        if (Array.isArray(target)) {
          if (method === 'slice') {
            const s = node.arguments[0] ? Number(evalExpr(node.arguments[0], env)) : 0;
            const e = node.arguments[1] ? Number(evalExpr(node.arguments[1], env)) : undefined;
            return target.slice(s, e);
          }
          if (method === 'filter') return target;
          if (method === 'join') {
            const sep = node.arguments[0] ? String(evalExpr(node.arguments[0], env)) : ',';
            return join(target,sep);
          }
          if (method === 'map' && node.arguments[0]) {
            const cb = node.arguments[0];
            if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
              return join((function*(){for(let idx=0;idx<target.length;idx++)yield invokeCallback(cb,[target[idx],idx],env);})());
            }
          }
        }
      }
      // Handle helper component calls
      if (ts.isIdentifier(node.expression) && components.has(node.expression.text)) {
        const comp = components.get(node.expression.text)!;
        const arg = node.arguments[0] ? evalExpr(node.arguments[0], env) : {};
        return invokeComponent(comp, arg, env);
      }
      return '';
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return renderJsx(node, env);
    }
    return '';
  }

  function bindParameter(param: ts.ParameterDeclaration, value: any, targetEnv: Env) {
    if (ts.isIdentifier(param.name)) {
      targetEnv[param.name.text] = value !== undefined ? value : (param.initializer ? evalExpr(param.initializer, targetEnv) : undefined);
    } else if (ts.isObjectBindingPattern(param.name)) {
      const obj = value && typeof value === 'object' ? value : {};
      for (const el of param.name.elements) {
        if (ts.isIdentifier(el.name)) {
          const propKey = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          targetEnv[el.name.text] = obj[propKey] !== undefined ? obj[propKey] : (el.initializer ? evalExpr(el.initializer, targetEnv) : undefined);
        }
      }
    } else if (ts.isArrayBindingPattern(param.name)) {
      const arr = Array.isArray(value) ? value : [];
      param.name.elements.forEach((el, idx) => {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
          targetEnv[el.name.text] = arr[idx] !== undefined ? arr[idx] : (el.initializer ? evalExpr(el.initializer, targetEnv) : undefined);
        }
      });
    }
  }

  function invokeCallback(fn: ts.ArrowFunction | ts.FunctionExpression, args: any[], parentEnv: Env): any {
    check();
    const localEnv: Env = { ...parentEnv };
    fn.parameters.forEach((param, idx) => bindParameter(param, args[idx], localEnv));
    if (ts.isBlock(fn.body)) {
      return evalBlock(fn.body, localEnv);
    }
    return evalExpr(fn.body, localEnv);
  }

  let componentDepth=0;
  function invokeComponent(fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression, props: Record<string, any>, parentEnv: Env): string {
    check();if(componentDepth>=64)throw new Error('Componentele preview se apelează recursiv prea adânc.');componentDepth++;
    try{
    const localEnv: Env = { ...topConsts, ...parentEnv, props };
    if (fn.parameters[0]) {
      bindParameter(fn.parameters[0], props, localEnv);
    }
    if (!fn.body) return '';
    if (ts.isBlock(fn.body)) {
      return String(evalBlock(fn.body, localEnv) ?? '');
    }
    return String(evalExpr(fn.body, localEnv) ?? '');
    }finally{componentDepth--;}
  }

  function evalBlock(block: ts.Block, env: Env): any {
    check();
    const localEnv: Env = { ...env };
    for (const stmt of block.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!decl.initializer) continue;
          const val = evalExpr(decl.initializer, localEnv);
          if (ts.isIdentifier(decl.name)) {
            localEnv[decl.name.text] = val;
          } else if (ts.isArrayBindingPattern(decl.name) && Array.isArray(val)) {
            decl.name.elements.forEach((el, idx) => {
              if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
                localEnv[el.name.text] = val[idx];
              }
            });
          } else if (ts.isObjectBindingPattern(decl.name) && val && typeof val === 'object') {
            for (const el of decl.name.elements) {
              if (ts.isIdentifier(el.name)) {
                const k = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
                localEnv[el.name.text] = val[k];
              }
            }
          }
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        components.set(stmt.name.text, stmt);
      } else if (ts.isReturnStatement(stmt)) {
        return evalExpr(stmt.expression, localEnv);
      }
    }
    return '';
  }

  function renderJsx(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, env: Env): string {
    check();
    if (ts.isJsxFragment(node)) {
      return join((function*(){for(const child of node.children)yield renderJsxChild(child,env);})());
    }
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const rawTag = opening.tagName.getText(source);
    const props = extractProps(opening.attributes, env);
    const childrenMarkup = ts.isJsxElement(node)
      ? join((function*(){for(const child of node.children)yield renderJsxChild(child,env);})())
      : '';

    // Custom component or Next Link
    if (rawTag === 'Link') {
      const href = escapeHtml(String(props.href || '#'));
      const cls = props.className ? ` class="${escapeHtml(String(props.className))}"` : '';
      return `<a href="${href}"${cls}>${childrenMarkup}</a>`;
    }
    if (/^[A-Z]/.test(rawTag)) {
      if (rawTag in externalComponents && externalComponents[rawTag]) {
        return externalComponents[rawTag];
      }
      const comp = components.get(rawTag);
      if (comp) {
        return invokeComponent(comp, { ...props, children: childrenMarkup }, env);
      }
      return `<div data-component="${escapeHtml(rawTag)}">${childrenMarkup}</div>`;
    }

    const tag = rawTag.toLowerCase();
    // Security: never emit script/iframe/object/form in preview
    if (['script', 'iframe', 'object', 'embed', 'base'].includes(tag)) return '';
    const safeTag = tag === 'form' ? 'div' : tag;

    const attrParts: string[] = [];
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false || key === 'key' || key === 'ref' || key === 'children') continue;
      if (/^on[A-Z]/.test(key)) continue;
      if (key === 'className') {
        if (String(val).trim()) attrParts.push(`class="${escapeHtml(String(val))}"`);
        continue;
      }
      if (key === 'htmlFor') {
        attrParts.push(`for="${escapeHtml(String(val))}"`);
        continue;
      }
      if (key === 'style' && typeof val === 'object') {
        const styleStr = Object.entries(val)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${camelToKebab(k)}:${typeof v === 'number' && !['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'order'].includes(k) ? `${v}px` : String(v)}`)
          .join(';');
        if (styleStr) attrParts.push(`style="${escapeHtml(styleStr)}"`);
        continue;
      }
      if (key === 'src' && typeof val === 'string') {
        const mapped = assetMap.get(val) || assetMap.get(val.replace(/^\.?\//, '')) || val;
        attrParts.push(`src="${escapeHtml(mapped)}"`);
        continue;
      }
      if (val === true) {
        attrParts.push(escapeHtml(key));
      } else if (typeof val === 'string' || typeof val === 'number') {
        attrParts.push(`${escapeHtml(key)}="${escapeHtml(String(val))}"`);
      }
    }

    const attrStr = attrParts.length ? ' ' + attrParts.join(' ') : '';
    if (VOID_TAGS.has(safeTag)) {
      return `<${safeTag}${attrStr}>`;
    }
    return `<${safeTag}${attrStr}>${childrenMarkup}</${safeTag}>`;
  }

  function renderJsxChild(child: ts.JsxChild, env: Env): string {
    check();
    if (ts.isJsxText(child)) {
      const cleaned = child.getText(source).replace(/\r\n/g, '\n');
      if (!cleaned.trim() && cleaned.includes('\n')) return '';
      return cleaned;
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      return renderJsx(child, env);
    }
    if (ts.isJsxExpression(child)) {
      if (!child.expression) return '';
      const val = evalExpr(child.expression, env);
      if (val === null || val === undefined || val === false || val === true) return '';
      if (Array.isArray(val)) return join((function*(){for(const item of val)yield item==null||item===false?'':String(item);})());
      return String(val);
    }
    return '';
  }

  function extractProps(attrs: ts.JsxAttributes, env: Env): Record<string, any> {
    const props: Record<string, any> = {};
    for (const prop of attrs.properties) {
      if (ts.isJsxAttribute(prop)) {
        const name = prop.name.getText(source);
        if (!prop.initializer) {
          props[name] = true;
        } else if (ts.isStringLiteral(prop.initializer)) {
          props[name] = prop.initializer.text;
        } else if (ts.isJsxExpression(prop.initializer)) {
          props[name] = evalExpr(prop.initializer.expression, env);
        }
      } else if (ts.isJsxSpreadAttribute(prop)) {
        const spreadVal = evalExpr(prop.expression, env);
        if (spreadVal && typeof spreadVal === 'object') Object.assign(props, spreadVal);
      }
    }
    return props;
  }

  if (!defaultComponent) return '';
  return invokeComponent(defaultComponent, {}, topConsts);
}
