// A small ICU MessageFormat reader: enough to compare arguments between languages and to catch broken syntax before the
// message reaches a customer. Rendering is done by use-intl; this module only inspects.

export interface IcuArgument {
  name: string;
  /** "argument" for a plain {name}, otherwise the declared type: number, date, time, plural, select, selectordinal. */
  type: string;
}

interface ParseResult {
  args: IcuArgument[];
  error: string | null;
}

class IcuSyntaxError extends Error {}

const NAME = /[^\s{},#<>']+/y;
const STRUCTURED = new Set(["plural", "select", "selectordinal"]);
const TAG = /<\/?[A-Za-z][\w-]*\s*\/?>/y;

class Parser {
  readonly args: IcuArgument[] = [];
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  parse(): void {
    this.message(0);
    if (this.pos < this.src.length) throw new IcuSyntaxError(`unexpected "}" at position ${this.pos}`);
  }

  /** Text with arguments; stops at an unmatched "}" (the caller consumes it). */
  private message(depth: number, inPlural = false): void {
    const s = this.src;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (c === "'") {
        this.quote(inPlural);
      } else if (c === "{") {
        this.pos++;
        this.argument();
      } else if (c === "}") {
        return;
      } else if (c === "<") {
        TAG.lastIndex = this.pos;
        const m = TAG.exec(s);
        this.pos += m ? m[0].length : 1;
      } else {
        this.pos++;
      }
    }
    if (depth > 0) throw new IcuSyntaxError("unclosed {");
  }

  /** ICU apostrophe rules (formatjs): '' is a literal apostrophe; ' before { } < > (and # in plurals) quotes until the next '. */
  private quote(inPlural: boolean): void {
    const s = this.src;
    const next = s[this.pos + 1];
    if (next === "'") {
      this.pos += 2;
    } else if (
      next !== undefined &&
      (next === "{" || next === "}" || next === "<" || next === ">" || (inPlural && next === "#"))
    ) {
      const end = s.indexOf("'", this.pos + 2);
      this.pos = end === -1 ? s.length : end + 1;
    } else {
      this.pos++;
    }
  }

  private skipSpace(): void {
    while (/\s/.test(this.src[this.pos] ?? "")) this.pos++;
  }

  private word(what: string): string {
    NAME.lastIndex = this.pos;
    const m = NAME.exec(this.src);
    if (!m) throw new IcuSyntaxError(`${what} expected at position ${this.pos}`);
    this.pos += m[0].length;
    return m[0];
  }

  private argument(): void {
    this.skipSpace();
    if (this.src[this.pos] === "}" || this.pos >= this.src.length) {
      throw new IcuSyntaxError(this.pos >= this.src.length ? "unclosed {" : "empty argument {}");
    }
    const name = this.word("argument name");
    this.skipSpace();
    const c = this.src[this.pos];
    if (c === "}") {
      this.pos++;
      this.args.push({ name, type: "argument" });
      return;
    }
    if (c !== ",")
      throw new IcuSyntaxError(this.pos >= this.src.length ? "unclosed {" : `"," or "}" expected after "${name}"`);
    this.pos++;
    this.skipSpace();
    const type = this.word("argument type");
    this.args.push({ name, type });
    this.skipSpace();
    if (this.src[this.pos] === "}") {
      this.pos++;
      return;
    }
    if (this.src[this.pos] !== ",")
      throw new IcuSyntaxError(this.pos >= this.src.length ? "unclosed {" : `"," or "}" expected after type "${type}"`);
    this.pos++;
    if (STRUCTURED.has(type)) this.options(type, name);
    else this.style();
  }

  /** Style of number/date/time: free text up to the closing brace (skeletons may contain quotes). */
  private style(): void {
    const end = this.src.indexOf("}", this.pos);
    if (end === -1) throw new IcuSyntaxError("unclosed {");
    this.pos = end + 1;
  }

  private options(type: string, name: string): void {
    let seenOther = false;
    this.skipSpace();
    if (type !== "select" && this.src.startsWith("offset:", this.pos)) {
      this.pos += "offset:".length;
      this.word("offset");
      this.skipSpace();
    }
    let count = 0;
    while (this.pos < this.src.length && this.src[this.pos] !== "}") {
      const selector = this.word("selector");
      this.skipSpace();
      if (this.src[this.pos] !== "{") throw new IcuSyntaxError(`"{" expected after selector "${selector}" of ${name}`);
      this.pos++;
      this.message(1, type !== "select");
      if (this.src[this.pos] !== "}") throw new IcuSyntaxError("unclosed {");
      this.pos++;
      if (selector === "other") seenOther = true;
      count++;
      this.skipSpace();
    }
    if (this.pos >= this.src.length) throw new IcuSyntaxError("unclosed {");
    this.pos++;
    if (count === 0) throw new IcuSyntaxError(`${type} "${name}" has no options`);
    if (!seenOther) throw new IcuSyntaxError(`${type} "${name}" requires an "other" option`);
  }
}

function run(message: string): ParseResult {
  const parser = new Parser(message);
  try {
    parser.parse();
    return { args: parser.args, error: null };
  } catch (e) {
    if (e instanceof IcuSyntaxError) return { args: parser.args, error: e.message };
    throw e;
  }
}

/** First syntax problem of a message, or null when it is valid. */
export function checkIcuSyntax(message: string): string | null {
  return run(message).error;
}

/** Sorted, unique argument names, including those inside plural and select branches. */
export function placeholders(message: string): string[] {
  return [...new Set(run(message).args.map((a) => a.name))].sort();
}

/** Sorted, unique "name:type" pairs: {n} and {n, number} are different contracts for the code that fills them. */
export function placeholderSignature(message: string): string[] {
  return [...new Set(run(message).args.map((a) => `${a.name}:${a.type}`))].sort();
}
