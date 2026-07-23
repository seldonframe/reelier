// Assert and bind mini-languages. Deliberately tiny: parse with a handful of
// regexes, and error loudly on anything that doesn't match (no silent no-op).

export interface ObservationRef {
  source: "header" | "body";
  key: string;
  value: string;
}

export interface Observation {
  status: number;
  headers: Record<string, string>;
  body: string;
  /**
   * Provider-issued identifiers cross-checkable against the provider's own
   * logs (trust-ladder spec §3) — captured from an ALLOWLIST only (never
   * guessed/scraped), omitted entirely when none were found. Populated by
   * the tool that produced this Observation (src/tools.ts's http.* from
   * response headers; src/mcp-tool.ts from a single-JSON-body's top-level
   * fields) and threaded onto `StepRecord.refs` for ANY executed step,
   * including reads — not just writes.
   */
  refs?: ObservationRef[];
}

export class AssertParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertParseError";
  }
}

export class BindParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindParseError";
  }
}

/** Result of evaluating one assert line. */
export interface AssertResult {
  ok: boolean;
  message: string;
}

function getJsonBody(obs: Observation): unknown {
  try {
    return JSON.parse(obs.body);
  } catch {
    throw new AssertParseError(`Assertion needs JSON body but body is not valid JSON: ${obs.body.slice(0, 200)}`);
  }
}

/** Resolve a dot-path like `a.b.c` or `a.0.b` against a JSON value. Returns undefined if not found. */
function resolveDotPath(value: unknown, dotpath: string): unknown {
  const parts = dotpath.split(".");
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function parseJsonScalar(text: string): unknown {
  return JSON.parse(text);
}

/** Evaluate a single assert-line against an observation. Throws AssertParseError if the line doesn't match the grammar. */
export function evalAssert(line: string, obs: Observation): AssertResult {
  let m: RegExpMatchArray | null;

  // status == <int> / status != <int>
  m = line.match(/^status\s*(==|!=)\s*(\d+)$/);
  if (m) {
    const [, op, numText] = m;
    const expected = parseInt(numText, 10);
    const ok = op === "==" ? obs.status === expected : obs.status !== expected;
    return { ok, message: ok ? "" : `status ${op} ${expected} failed: got ${obs.status}` };
  }

  // body contains "<text>" / body not contains "<text>"
  // The quoted text may never contain a raw newline: an assert/bind is the
  // skill file's line-based grammar's unit (one physical line per
  // "- assert: ..." bullet — see src/skill.ts), so an embedded \n or \r here
  // would silently split into extra bogus lines (or worse, a bogus
  // "### Step N" header) the moment it's written back by
  // serializeSkill/renderStepBlock. Reject at the parser itself so this is
  // true for every caller, not just LLM-proposed patches (src/escalate.ts
  // additionally rejects newline-bearing lines before they ever reach here —
  // this is defense in depth, not the only guard).
  m = line.match(/^body\s+(not\s+contains|contains)\s+"([^\r\n]*)"$/);
  if (m) {
    const [, kind, text] = m;
    const has = obs.body.includes(text);
    const ok = kind === "contains" ? has : !has;
    return {
      ok,
      message: ok ? "" : `body ${kind} ${JSON.stringify(text)} failed (body length ${obs.body.length})`,
    };
  }

  // json.<dotpath> is array / set / number / string / boolean / null
  m = line.match(/^json\.([a-zA-Z0-9_.]+)\s+is\s+(array|set|number|string|boolean|null)$/);
  if (m) {
    const [, dotpath, kind] = m;
    const json = getJsonBody(obs);
    const val = resolveDotPath(json, dotpath);
    const ok =
      kind === "array"
        ? Array.isArray(val)
        : kind === "set"
          ? val !== undefined && val !== null
          : kind === "number"
            ? typeof val === "number"
            : kind === "string"
              ? typeof val === "string"
              : kind === "boolean"
                ? typeof val === "boolean"
                : /* null */ val === null;
    return { ok, message: ok ? "" : `json.${dotpath} is ${kind} failed: got ${JSON.stringify(val)}` };
  }

  // json.<dotpath> matches /<regex>/ — assert a string value matches a pattern.
  m = line.match(/^json\.([a-zA-Z0-9_.]+)\s+matches\s+\/(.*)\/$/);
  if (m) {
    const [, dotpath, pattern] = m;
    const json = getJsonBody(obs);
    const val = resolveDotPath(json, dotpath);
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new AssertParseError(`Invalid regex in assert: ${(err as Error).message}`);
    }
    const ok = typeof val === "string" && re.test(val);
    return { ok, message: ok ? "" : `json.${dotpath} matches /${pattern}/ failed: got ${JSON.stringify(val)}` };
  }

  // json.<dotpath> length >= / <= / > / < <int>
  m = line.match(/^json\.([a-zA-Z0-9_.]+)\s+length\s*(>=|<=|>|<)\s*(\d+)$/);
  if (m) {
    const [, dotpath, op, numText] = m;
    const expected = parseInt(numText, 10);
    const json = getJsonBody(obs);
    const val = resolveDotPath(json, dotpath);
    let len: number | undefined;
    if (Array.isArray(val) || typeof val === "string") len = val.length;
    let ok = false;
    if (len !== undefined) {
      ok = op === ">" ? len > expected : op === "<" ? len < expected : op === ">=" ? len >= expected : len <= expected;
    }
    return {
      ok,
      message: ok ? "" : `json.${dotpath} length ${op} ${expected} failed: got ${JSON.stringify(val)}`,
    };
  }

  // json.<dotpath> == <json-scalar> / != / >= / <= / > / <
  m = line.match(/^json\.([a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (m) {
    const [, dotpath, op, rawScalar] = m;
    const json = getJsonBody(obs);
    const val = resolveDotPath(json, dotpath);
    let expected: unknown;
    try {
      expected = parseJsonScalar(rawScalar.trim());
    } catch {
      throw new AssertParseError(`Invalid JSON scalar in assert: ${JSON.stringify(rawScalar)}`);
    }
    let ok: boolean;
    switch (op) {
      case "==":
        ok = val === expected;
        break;
      case "!=":
        ok = val !== expected;
        break;
      case ">":
        ok = typeof val === "number" && typeof expected === "number" && val > expected;
        break;
      case "<":
        ok = typeof val === "number" && typeof expected === "number" && val < expected;
        break;
      case ">=":
        ok = typeof val === "number" && typeof expected === "number" && val >= expected;
        break;
      case "<=":
        ok = typeof val === "number" && typeof expected === "number" && val <= expected;
        break;
      default:
        ok = false;
    }
    return {
      ok,
      message: ok ? "" : `json.${dotpath} ${op} ${JSON.stringify(expected)} failed: got ${JSON.stringify(val)}`,
    };
  }

  throw new AssertParseError(`Unrecognized assert expression: ${JSON.stringify(line)}`);
}

/** Result of evaluating one bind line. */
export interface BindResult {
  ok: boolean;
  name: string;
  value?: unknown;
  message: string;
}

/** Evaluate a single bind-line against an observation. Throws BindParseError if the line doesn't match the grammar. */
export function evalBind(line: string, obs: Observation): BindResult {
  let m: RegExpMatchArray | null;

  // <name> = json.<dotpath>
  m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*json\.([a-zA-Z0-9_.]+)$/);
  if (m) {
    const [, name, dotpath] = m;
    const json = getJsonBody(obs);
    const val = resolveDotPath(json, dotpath);
    if (val === undefined) {
      return { ok: false, name, message: `bind ${name} = json.${dotpath} failed: path not found` };
    }
    return { ok: true, name, value: val, message: "" };
  }

  // <name> = body match /<regex>/
  m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*body\s+match\s+\/(.*)\/$/);
  if (m) {
    const [, name, pattern] = m;
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new BindParseError(`Invalid regex in bind: ${(err as Error).message}`);
    }
    const match = obs.body.match(re);
    if (!match || match[1] === undefined) {
      return { ok: false, name, message: `bind ${name} = body match /${pattern}/ failed: no capture-group match` };
    }
    return { ok: true, name, value: match[1], message: "" };
  }

  throw new BindParseError(`Unrecognized bind expression: ${JSON.stringify(line)}`);
}
