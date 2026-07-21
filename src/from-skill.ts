// `reelier compile --from-skill <SKILL.md>` — identity reader for Agent-Skills
// instruction skills. Reads ONLY the source skill's frontmatter (name,
// description) so the compiled deterministic skill can carry them; steps are
// NEVER derived from the instruction text — they come exclusively from a
// recorded trace (never-lies: Reelier does not generate steps it didn't see).
//
// Deliberately tolerant of frontmatter fields Reelier doesn't know
// (`allowed-tools`, `license`, `metadata`, ...) — those belong to the source
// skill's own runtime — but strict about what it carries: a missing or empty
// `name`/`description` is an explicit error, never a guessed default.

export interface InstructionSkillFrontmatter {
  name: string;
  description: string;
}

/**
 * Chars accepted in a carried skill name: it becomes the compiled skill's
 * identity AND its default file name (`<name>.skill.md`), so path separators
 * and leading dots/dashes are rejected loudly instead of sanitized silently.
 */
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

const BLOCK_SCALARS = new Set(["|", ">", "|-", ">-", "|+", ">+"]);

/** Strip one layer of matching surrounding quotes (YAML single-line quoted scalar). */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the frontmatter of an Agent-Skills instruction SKILL.md, returning
 * only the fields Reelier carries into a compiled skill. Throws an Error with
 * an instructive message on anything it can't honestly answer.
 */
export function parseInstructionSkillFrontmatter(source: string): InstructionSkillFrontmatter {
  const lines = source.split(/\r\n|\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error(
      "the source skill has no frontmatter — an Agent Skills SKILL.md starts with a '---' fence containing at least 'name:' and 'description:'"
    );
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error("the source skill's frontmatter fence '---' is never closed");
  }
  const fm = lines.slice(1, endIdx);

  const fields = new Map<string, string>();
  for (let i = 0; i < fm.length; i++) {
    const raw = fm[i];
    if (raw.trim() === "") continue;
    // An indented line belongs to a prior key's nested/multi-line value; the
    // block scalars the converter cares about are consumed explicitly below.
    if (/^\s/.test(raw)) continue;
    const m = raw.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue; // tolerated: not a flat key the converter needs
    const key = m[1];
    let value = m[2].trim();
    if (BLOCK_SCALARS.has(value)) {
      // Minimal block-scalar support: join the contiguous indented lines.
      const parts: string[] = [];
      let j = i + 1;
      while (j < fm.length && /^\s+\S/.test(fm[j])) {
        parts.push(fm[j].trim());
        j++;
      }
      i = j - 1;
      value = parts.join(" ");
    } else {
      value = unquote(value);
    }
    if (!fields.has(key)) fields.set(key, value);
  }

  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) {
    throw new Error(
      "the source skill's frontmatter has no usable 'name' — add one; it becomes the compiled skill's name"
    );
  }
  if (!description) {
    throw new Error(
      "the source skill's frontmatter has no usable 'description' — add one; it is carried into the compiled skill verbatim"
    );
  }
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(
      `the source skill's name ${JSON.stringify(name)} contains characters unsafe for a file name — ` +
        "the compiled skill is written to <name>.skill.md; rename it using letters, digits, dots, " +
        "underscores, spaces, or hyphens (starting with a letter or digit)"
    );
  }
  return { name, description };
}
