import type { AgentTool, AgentToolContext, AgentToolResult } from '../types.js';

export interface CalculatorInput {
  expression: string;
}

type TokenType = 'NUMBER' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'FUNC';

interface Token {
  type: TokenType;
  value: string;
}

const SUPPORTED_FUNCTIONS = new Set([
  'sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'sin', 'cos', 'tan', 'log'
]);

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  if (s.length > 250) {
    throw new Error('Expression exceeds maximum allowed length of 250 characters');
  }

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    if (['+', '-', '*', '/', '%', '^'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }

    // Numbers: digits, optional decimal dot, optional exponent
    if (/\d/.test(ch) || (ch === '.' && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let numStr = '';
      while (i < s.length && (/\d/.test(s[i]) || s[i] === '.')) {
        numStr += s[i];
        i++;
      }
      if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        numStr += s[i];
        i++;
        if (i < s.length && (s[i] === '+' || s[i] === '-')) {
          numStr += s[i];
          i++;
        }
        while (i < s.length && /\d/.test(s[i])) {
          numStr += s[i];
          i++;
        }
      }
      tokens.push({ type: 'NUMBER', value: numStr });
      continue;
    }

    // Function names or constants: alphabetic characters only
    if (/[a-zA-Z]/.test(ch)) {
      let ident = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        ident += s[i];
        i++;
      }
      const lower = ident.toLowerCase();
      if (lower in CONSTANTS) {
        tokens.push({ type: 'NUMBER', value: String(CONSTANTS[lower]) });
      } else if (SUPPORTED_FUNCTIONS.has(lower)) {
        tokens.push({ type: 'FUNC', value: lower });
      } else {
        throw new Error(`Unsupported identifier or function: "${ident}"`);
      }
      continue;
    }

    throw new Error(`Invalid or unrecognized character in expression: "${ch}"`);
  }

  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(expected?: TokenType, val?: string): Token {
    const t = this.peek();
    if (!t) {
      throw new Error('Unexpected end of expression');
    }
    if (expected && t.type !== expected) {
      throw new Error(`Expected token ${expected}, got ${t.type} (${t.value})`);
    }
    if (val && t.value !== val) {
      throw new Error(`Expected "${val}", got "${t.value}"`);
    }
    this.pos++;
    return t;
  }

  parse(): number {
    this.depth = 0;
    const res = this.parseExpression();
    if (this.pos < this.tokens.length) {
      const leftover = this.tokens[this.pos];
      throw new Error(`Unexpected token after expression: "${leftover.value}"`);
    }
    return res;
  }

  // Precedence 1: Addition & Subtraction
  private parseExpression(): number {
    this.checkDepth();
    let left = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const t = this.peek();
      if (t && t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        this.consume();
        const right = this.parseTerm();
        if (t.value === '+') left += right;
        else left -= right;
      } else {
        break;
      }
    }
    return left;
  }

  // Precedence 2: Multiplication, Division, Modulo
  private parseTerm(): number {
    this.checkDepth();
    let left = this.parseExponent();

    while (this.pos < this.tokens.length) {
      const t = this.peek();
      if (t && t.type === 'OP' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.consume();
        const right = this.parseExponent();
        if (t.value === '*') {
          left *= right;
        } else if (t.value === '/') {
          if (right === 0) throw new Error('Division by zero');
          left /= right;
        } else if (t.value === '%') {
          if (right === 0) throw new Error('Modulo by zero');
          left %= right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  // Precedence 3: Exponentiation (right-associative)
  private parseExponent(): number {
    this.checkDepth();
    let left = this.parseUnary();

    const t = this.peek();
    if (t && t.type === 'OP' && t.value === '^') {
      this.consume();
      const right = this.parseExponent(); // right-associative recursion
      left = Math.pow(left, right);
    }
    return left;
  }

  // Precedence 4: Unary operators (+, -)
  private parseUnary(): number {
    this.checkDepth();
    const t = this.peek();
    if (t && t.type === 'OP' && (t.value === '+' || t.value === '-')) {
      this.consume();
      const val = this.parseUnary();
      return t.value === '-' ? -val : val;
    }
    return this.parsePrimary();
  }

  // Precedence 5: Primary (Numbers, Functions, Parenthesized expressions)
  private parsePrimary(): number {
    this.checkDepth();
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.type === 'NUMBER') {
      this.consume();
      const n = Number(t.value);
      if (!Number.isFinite(n)) throw new Error(`Invalid number representation: "${t.value}"`);
      return n;
    }

    if (t.type === 'LPAREN') {
      this.consume('LPAREN');
      this.depth++;
      const val = this.parseExpression();
      this.depth--;
      this.consume('RPAREN');
      return val;
    }

    if (t.type === 'FUNC') {
      const fnToken = this.consume('FUNC');
      this.consume('LPAREN');
      const args: number[] = [];
      if (this.peek()?.type !== 'RPAREN') {
        while (true) {
          this.depth++;
          args.push(this.parseExpression());
          this.depth--;
          if (this.peek()?.type === 'COMMA') {
            this.consume('COMMA');
          } else {
            break;
          }
        }
      }
      this.consume('RPAREN');

      return this.evaluateFunction(fnToken.value, args);
    }

    throw new Error(`Unexpected token: "${t.value}"`);
  }

  private checkDepth() {
    if (this.depth > 50) {
      throw new Error('Expression recursion limit exceeded (maximum nesting depth 50)');
    }
  }

  private evaluateFunction(name: string, args: number[]): number {
    switch (name) {
      case 'sqrt':
        if (args.length !== 1) throw new Error('sqrt() expects exactly 1 argument');
        if (args[0] < 0) throw new Error('sqrt() of negative number is undefined in real numbers');
        return Math.sqrt(args[0]);
      case 'abs':
        if (args.length !== 1) throw new Error('abs() expects exactly 1 argument');
        return Math.abs(args[0]);
      case 'round':
        if (args.length !== 1) throw new Error('round() expects exactly 1 argument');
        return Math.round(args[0]);
      case 'floor':
        if (args.length !== 1) throw new Error('floor() expects exactly 1 argument');
        return Math.floor(args[0]);
      case 'ceil':
        if (args.length !== 1) throw new Error('ceil() expects exactly 1 argument');
        return Math.ceil(args[0]);
      case 'min':
        if (args.length < 1) throw new Error('min() expects at least 1 argument');
        return Math.min(...args);
      case 'max':
        if (args.length < 1) throw new Error('max() expects at least 1 argument');
        return Math.max(...args);
      case 'sin':
        if (args.length !== 1) throw new Error('sin() expects exactly 1 argument');
        return Math.sin(args[0]);
      case 'cos':
        if (args.length !== 1) throw new Error('cos() expects exactly 1 argument');
        return Math.cos(args[0]);
      case 'tan':
        if (args.length !== 1) throw new Error('tan() expects exactly 1 argument');
        return Math.tan(args[0]);
      case 'log':
        if (args.length !== 1) throw new Error('log() expects exactly 1 argument');
        if (args[0] <= 0) throw new Error('log() argument must be strictly positive');
        return Math.log(args[0]);
      default:
        throw new Error(`Unsupported math function: ${name}`);
    }
  }
}

export function evaluateMathExpression(expr: string): number {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    throw new Error('Expression string cannot be empty');
  }

  const tokens = tokenize(expr);
  if (tokens.length === 0) {
    throw new Error('No valid tokens found in expression');
  }

  const parser = new Parser(tokens);
  const rawResult = parser.parse();

  if (!Number.isFinite(rawResult)) {
    throw new Error('Calculation resulted in non-finite value (Infinity or NaN)');
  }

  // Clean floating point rounding noise (e.g. 0.1 + 0.2 = 0.30000000000000004 -> 0.3)
  const rounded = Math.round(rawResult * 1e12) / 1e12;
  return rounded;
}

export const calculatorTool: AgentTool = {
  id: 'calculator',
  name: 'Mathematical Calculator',
  description: 'Evaluates standard mathematical expressions deterministically without eval. Supports +, -, *, /, %, ^, parentheses, negative numbers, decimals, and math functions (sqrt, abs, round, floor, ceil, min, max, sin, cos, tan, log).',
  category: 'UTILITY',
  permissionLevel: 'READ_ONLY',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: "The mathematical expression to evaluate (e.g., '150 * 1.19', '(450 + 200) / 2', 'sqrt(144) + 10^2', 'round(15.75) * 4')"
      }
    },
    required: ['expression']
  },
  async execute(input: CalculatorInput, _context: AgentToolContext): Promise<AgentToolResult> {
    try {
      const result = evaluateMathExpression(input.expression);
      return {
        success: true,
        data: {
          expression: input.expression,
          result,
          formatted: String(result)
        },
        summary: `${input.expression} = ${result}`
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Calculation error: ${err?.message || 'Invalid mathematical expression'}`
      };
    }
  }
};
