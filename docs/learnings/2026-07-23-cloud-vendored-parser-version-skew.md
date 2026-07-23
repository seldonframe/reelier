# Cloud parser version skew silently breaks new skill-file fields

**The problem, in one line.** `reelier push` of a skill carrying the 0.19 `approve:` step field was rejected by reelier.com with "unparseable skill: Unrecognized step field" — the OSS CLI and its own cloud disagreed about the file format.

**The approach.**
1. Reproduce with a real push (the error names the exact line/field).
2. Grep the error string in the cloud repo — no hit. Grep it in the OSS repo — hit in `src/skill.ts`, but its message *includes* `approve` in the expected-fields list. Conclusion: the cloud runs an OLDER parser than the message suggests.
3. Check where the cloud gets its parser: `package.json` had `"reelier": "^0.12.0"`. For 0.x versions, caret pins the minor — the cloud was parsing with a seven-minor-old grammar.
4. Fix = bump the dep to the current release (`^0.20.0`), `npm install`, then verify with the cloud's exact import specifier before building: `node --input-type=module -e "import {parseSkill} from 'reelier/skill'; …"` against the failing file.
5. Full `tsc --noEmit` + `next build` to catch any other API drift across every file importing from the package (all exports still existed; zero code changes needed).

**Judgment calls.** Did NOT patch the cloud's error path or add a field-tolerant parser — the cloud must parse with the real grammar, not forgive unknown fields (a forgiving parser would silently drop `approve:` and change replay semantics). Did NOT vendor the parser into the cloud — staying on the npm package keeps one source of truth; the fix is keeping it current.

**The reusable rule, one line.** Any repo that consumes a fast-moving sibling package via `^0.x` is frozen at that minor — every OSS release that adds a wire/file-format field must bump the cloud dep in the same wave, and the cross-seam test must include a file using the NEWEST field.
