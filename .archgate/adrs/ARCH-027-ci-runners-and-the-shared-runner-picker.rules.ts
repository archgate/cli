/// <reference path="../rules.d.ts" />

/** The one picker action the enterprise uses. */
const PICKER_ACTION = "barretotech/runner-picker";
/** Any runner-picker action reference, with or without a subpath: owner, repository, subpath, ref. */
const PICKER_REF = /^([\w.-]+)\/(runner-picker)((?:\/[^@]*)?)@(.+)$/iu;
/** A full commit SHA. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
/** A runner label or expression that targets the shared pool or Blacksmith. */
const POOL_TARGET =
  /\bself-hosted\b|\btatuicloud[\w-]*|\bblacksmith-[\w.-]+|\bvars\.\w*RUNNER(?:_\w+)?\b/iu;
/** A job output read in a `runs-on` expression, with the job's name. */
const OUTPUT_REF =
  /needs(?:\.([\w-]+)|\[\s*['"]([\w-]+)['"]\s*\])\s*\.outputs(?:\.runs-on|\[\s*['"]runs-on['"]\s*\])/giu;
/** What a job output reference reads as once replaced, to test the operators around it. */
const OUTPUT_MARK = "@picker-output@";
/**
 * An output used as anything but a value with a fallback: followed by `&&`
 * (the next operand wins whenever it is set) or compared, which discards it.
 */
const OUTPUT_MISUSE =
  /@picker-output@\s*(?:&&|[=!]=|[<>])|(?:[=!]=|[<>]=?)\s*@picker-output@/u;
/** An output followed by `||`, the fallback a skipped or failed picker leaves room for. */
const OUTPUT_FALLBACK = /@picker-output@\s*\|\|/gu;
/** A `runs-on` that reads a matrix value. */
const MATRIX_VALUE = /\bmatrix\.([\w-]+)/giu;
/** The marker of a job whose purpose is the self-hosted machine itself. */
const EXEMPT = /#\s*runner-picker:\s*exempt\b\s*[-:]\s*\S/iu;
/** The inputs a picker step must set: the input name and what its value must read. */
const REQUIRED_INPUTS: readonly (readonly [string, RegExp])[] = [
  ["source", /^service$/u],
  ["capacity-url", /^\$\{\{\s*vars\.RUNNER_CAPACITY_URL\s*\}\}$/u],
  ["tailnet-client-id", /^\$\{\{\s*vars\.TAILNET_CLIENT_ID_PICKER\s*\}\}$/u],
];
/** The file the enterprise-adrs Sync workflow keeps current with the repository's visibility. */
const REPOSITORY_FILE = ".archgate/repository.json";

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };
type Mapping = { [key: string]: Yaml };
type Step = { file: string; line: number; uses: string; with: Mapping };
type Job = {
  file: string;
  name: string;
  units: string[];
  line: number;
  exempt: boolean;
  needs: string[];
  picker: boolean;
};

const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value under `key` in a parsed YAML mapping, absent when the key is. */
function field(mapping: Mapping, key: string): Yaml | undefined {
  return mapping[key];
}

/** Every string inside a YAML value, however deep. */
function strings(value: Yaml | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item));
  if (isMapping(value))
    return Object.values(value).flatMap((item) => strings(item));
  return value === null || value === undefined ? [] : [String(value)];
}

/** The indentation of a line. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The mapping key a line opens, unquoted, or undefined for a comment, item or blank line. */
function keyOf(line: string): string | undefined {
  const text = line.trimStart();
  if (text === "" || text.startsWith("#") || text.startsWith("-"))
    return undefined;
  const colon = text.indexOf(":");
  return colon > 0
    ? text.slice(0, colon).replaceAll(/^["']|["']$/gu, "")
    : undefined;
}

/** A key whose value is a block scalar (`run: |`, `script: >-`). */
const BLOCK_SCALAR = /:\s*[|>](?:[+-]\d?|\d[+-]?)?\s*(?:#.*)?$/u;

/** A quoted value that opens on a line: the text from its opening quote on. */
const QUOTED_VALUE = /(?:^|:\s+|-\s+)(["'])(.*)$/u;

/** Whether `text`, inside a scalar quoted with `quote`, contains the closing quote. */
function closes(text: string, quote: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quote === '"' && char === "\\") index++;
    else if (char === quote && quote === "'" && text.charAt(index + 1) === "'")
      index++;
    else if (char === quote) return true;
  }
  return false;
}

/** Which lines are YAML structure rather than the inside of a block or multi-line quoted scalar. */
function structural(lines: string[]): boolean[] {
  let block: number | undefined;
  let quote: string | undefined;
  return lines.map((line) => {
    if (quote !== undefined) {
      if (closes(line, quote)) quote = undefined;
      return false;
    }
    const blank = line.trim() === "";
    if (block !== undefined && (blank || indentOf(line) > block)) return false;
    block = BLOCK_SCALAR.test(line) ? indentOf(line) : undefined;
    const opened = QUOTED_VALUE.exec(line.trimStart().replace(/\s+#.*$/u, ""));
    const mark = opened?.at(1);
    if (mark !== undefined && !closes(opened?.at(2) ?? "", mark)) quote = mark;
    return !blank;
  });
}

type Literal = boolean | number | string | null;
/** A token of a constant expression: literals, operators and parentheses only. */
const TOKEN =
  /\s*(\(|\)|==|!=|&&|\|\||!|true\b|false\b|null\b|-?\d+(?:\.\d+)?|'(?:[^']|'')*')/uy;

/** GitHub's number coercion of a literal. */
function numberOf(value: Literal): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "number"
    ? value
    : value.trim() === ""
      ? 0
      : Number(value);
}

/** GitHub's truthiness of a literal. */
const truthy = (value: Literal): boolean =>
  value !== false &&
  value !== null &&
  value !== "" &&
  value !== 0 &&
  !Number.isNaN(value);

/** GitHub's loose equality of two literals: strings case-insensitively, otherwise as numbers. */
function equal(left: Literal, right: Literal): boolean {
  if (typeof left === "string" && typeof right === "string")
    return left.toLowerCase() === right.toLowerCase();
  return numberOf(left) === numberOf(right);
}

/** The value of an expression made only of literals, or undefined when it reads any context. */
function constantValue(expression: string): Literal | undefined {
  const tokens: string[] = [];
  let read = 0;
  TOKEN.lastIndex = 0;
  for (
    let match = TOKEN.exec(expression);
    match !== null;
    match = TOKEN.exec(expression)
  ) {
    tokens.push(match.at(1) ?? "");
    read = TOKEN.lastIndex;
  }
  if (expression.slice(read).trim() !== "" || tokens.length === 0)
    return undefined;
  let at = 0;
  const primary = (): Literal | undefined => {
    const token = tokens.at(at++);
    if (token === "(") {
      const value = or();
      return tokens.at(at++) === ")" ? value : undefined;
    }
    if (token === "!") {
      const value = primary();
      return value === undefined ? undefined : !truthy(value);
    }
    if (token === "true" || token === "false") return token === "true";
    if (token === "null") return null;
    if (token?.startsWith("'") === true)
      return token.slice(1, -1).replaceAll("''", "'");
    return token === undefined || Number.isNaN(Number(token))
      ? undefined
      : Number(token);
  };
  const comparison = (): Literal | undefined => {
    let left = primary();
    while (tokens.at(at) === "==" || tokens.at(at) === "!=") {
      const negate = tokens.at(at++) === "!=";
      const right = primary();
      if (left === undefined || right === undefined) return undefined;
      left = equal(left, right) !== negate;
    }
    return left;
  };
  const and = (): Literal | undefined => {
    let left = comparison();
    while (tokens.at(at) === "&&") {
      at++;
      const right = comparison();
      if (left === undefined || right === undefined) return undefined;
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = (): Literal | undefined => {
    let left = and();
    while (tokens.at(at) === "||") {
      at++;
      const right = and();
      if (left === undefined || right === undefined) return undefined;
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const value = or();
  return at === tokens.length ? value : undefined;
}

/** A job condition that is constantly false, such as `false` or `${{ !true }}`, so the job never runs. */
function neverRuns(condition: Yaml | undefined): boolean {
  if (condition === undefined || condition === null) return false;
  if (typeof condition === "boolean" || typeof condition === "number")
    return !truthy(condition);
  if (typeof condition !== "string") return false;
  const wrapped = /^\s*\$\{\{([\s\S]*)\}\}\s*$/u.exec(condition);
  const value = constantValue(wrapped?.at(1) ?? condition);
  return value !== undefined && !truthy(value);
}

/**
 * The value of a `uses:` key line, unquoted and without a trailing comment, or
 * undefined. A key needs a space after its colon, so plain-scalar text such as
 * `uses:owner/action` never counts.
 */
function usesOf(line: string): string | undefined {
  const text = line.trimStart().replace(/^-\s+/u, "");
  if (!/^uses:(?:\s|$)/u.test(text)) return undefined;
  return text
    .slice("uses:".length)
    .replace(/\s+#.*$/u, "")
    .trim()
    .replaceAll(/^["']|["']$/gu, "");
}

/** Each job's line range under the top-level `jobs:` key, as [first, end) indexes, by name. */
function jobBlocks(lines: string[]): Map<string, readonly [number, number]> {
  const blocks = new Map<string, readonly [number, number]>();
  const top = lines.findIndex(
    (line) => indentOf(line) === 0 && keyOf(line) === "jobs"
  );
  if (top < 0) return blocks;
  let depth: number | undefined;
  let open: { name: string; first: number } | undefined;
  let index = top + 1;
  for (; index < lines.length; index++) {
    const line = lines.at(index) ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    depth ??= indent;
    const key = indent === depth ? keyOf(line) : undefined;
    if (key === undefined) continue;
    if (open !== undefined) blocks.set(open.name, [open.first, index]);
    open = { name: key, first: index };
  }
  if (open !== undefined) blocks.set(open.name, [open.first, index]);
  return blocks;
}

/** The index of the job's own block `runs-on:` key, or undefined for a flow-style job. */
function runsOnIndex(
  lines: string[],
  [first, end]: readonly [number, number]
): number | undefined {
  const child = lines
    .slice(first + 1, end)
    .find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const depth = child === undefined ? -1 : indentOf(child);
  for (let index = first + 1; index < end; index++) {
    const line = lines.at(index) ?? "";
    if (indentOf(line) === depth && keyOf(line) === "runs-on") return index;
  }
  return undefined;
}

/**
 * The units of a `runs-on` value, each checked on its own: the string, each
 * label of a list, and each field of a `group`/`labels` mapping. GitHub applies
 * a mapping's fields together, so their order means nothing.
 */
function runsOnUnits(value: Yaml | undefined): string[] {
  return strings(value).map((unit) => unit.trim());
}

/** The values a `runs-on` takes from the job's matrix, including `include` entries. */
function matrixValues(
  units: readonly string[],
  strategy: Yaml | undefined
): string[] {
  const matrix = isMapping(strategy) ? field(strategy, "matrix") : undefined;
  if (!isMapping(matrix)) return [];
  const keys = units.flatMap((unit) =>
    [...unit.matchAll(MATRIX_VALUE)].map((match) => match.at(1) ?? "")
  );
  const listed = field(matrix, "include");
  const include = Array.isArray(listed) ? listed : [];
  return keys.flatMap((key) =>
    strings(matrix[key]).concat(
      include.flatMap((entry) => (isMapping(entry) ? strings(entry[key]) : []))
    )
  );
}

/** A workflow or composite action, parsed, or the reason it could not be. */
type Parsed =
  | { file: string; lines: string[]; content: Yaml }
  | { file: string; error: string };

/**
 * The workflow and composite-action files of the repository, read once. A file
 * that does not parse is listed in `unreadable` and the others are still read.
 */
async function load(
  ctx: RuleContext
): Promise<{
  steps: Step[];
  jobs: Job[];
  unreadable: { file: string; error: string }[];
}> {
  const files = ctx.scopedFiles.filter((file) => /\.ya?ml$/u.test(file));
  const parsed: Parsed[] = await Promise.all(
    files.map(async (file): Promise<Parsed> => {
      try {
        const content: Yaml = (await ctx.readYAML(file)).content;
        return {
          file,
          lines: (await ctx.readFile(file)).split(/\r?\n/u),
          content,
        };
      } catch (error) {
        return { file, error: String(error) };
      }
    })
  );
  const unreadable = parsed.flatMap((item) => ("error" in item ? [item] : []));
  const steps: Step[] = [];
  const jobs: Job[] = [];
  for (const item of parsed) {
    if ("error" in item) continue;
    const { file, lines, content } = item;
    if (!isMapping(content)) continue;
    // Steps are read in document order, so the nth step using an action is on
    // the nth structural line using it; script text never counts.
    const yaml = structural(lines);
    const seen = new Map<string, number>();
    const collect = (list: Yaml | undefined): Step[] =>
      (Array.isArray(list) ? list : []).flatMap((step) => {
        if (!isMapping(step)) return [];
        const uses = field(step, "uses");
        if (typeof uses !== "string") return [];
        const action = uses.trim();
        const nth = seen.get(action) ?? 0;
        seen.set(action, nth + 1);
        const at = lines
          .map((line, index) =>
            yaml.at(index) === true && usesOf(line) === action ? index : -1
          )
          .filter((index) => index >= 0)
          .at(nth);
        const inputs = field(step, "with");
        return [
          {
            file,
            line: at === undefined ? 1 : at + 1,
            uses: action,
            with: isMapping(inputs) ? inputs : {},
          },
        ];
      });
    const blocks = jobBlocks(lines);
    const runs = field(content, "runs");
    if (isMapping(runs)) steps.push(...collect(field(runs, "steps")));
    const declaredJobs = field(content, "jobs");
    if (!isMapping(declaredJobs)) continue;
    for (const [name, job] of Object.entries(declaredJobs)) {
      if (!isMapping(job)) continue;
      const jobSteps = collect(field(job, "steps"));
      steps.push(...jobSteps);
      const block = blocks.get(name);
      // Only a block `runs-on:` key can carry the exemption marker; a flow-style
      // job is reported at its own line and is never exempt.
      const key = block === undefined ? undefined : runsOnIndex(lines, block);
      const at = key ?? block?.[0] ?? 0;
      // A reusable-workflow call passes its runner as an input instead.
      const own = runsOnUnits(job["runs-on"]).concat(
        "uses" in job ? runsOnUnits(field(job, "with")) : []
      );
      jobs.push({
        file,
        name,
        units: own.concat(
          matrixValues(own, field(job, "strategy")).map((unit) => unit.trim())
        ),
        line: at + 1,
        exempt:
          key !== undefined && key > 0 && EXEMPT.test(lines.at(key - 1) ?? ""),
        needs: strings(field(job, "needs")),
        picker:
          jobSteps.some((step) => PICKER_REF.test(step.uses)) &&
          !neverRuns(field(job, "if")),
      });
    }
  }
  return { steps, jobs, unreadable };
}

/** Whether a job targets the pool or Blacksmith in any `runs-on` unit or matrix value it reads. */
const targetsPool = (job: Job): boolean =>
  job.units.some((unit) => POOL_TARGET.test(unit));

/** A `runs-on` unit with each job output reference replaced by OUTPUT_MARK. */
const marked = (unit: string): string =>
  unit.replaceAll(OUTPUT_REF, OUTPUT_MARK);

/** Whether every job output a unit reads is followed by a `||` fallback. */
function hasFallbacks(unit: string): boolean {
  const text = marked(unit);
  return (
    text.split(OUTPUT_MARK).length - 1 ===
    [...text.matchAll(OUTPUT_FALLBACK)].length
  );
}

/**
 * Whether one `runs-on` unit that names the pool takes it from picker jobs: it
 * reads at least one job output, every output it reads is a picker job's that
 * the job needs and has a fallback, no pool label or runner variable comes
 * before the first output, and no output is combined with `&&` or compared.
 */
function routedUnit(unit: string, job: Job, jobs: readonly Job[]): boolean {
  const refs = [...unit.matchAll(OUTPUT_REF)];
  const first = refs.at(0);
  if (first === undefined || OUTPUT_MISUSE.test(marked(unit))) return false;
  const pool = POOL_TARGET.exec(unit);
  if (pool !== null && pool.index < first.index) return false;
  return refs.every((ref) => {
    const name = ref.at(1) ?? ref.at(2) ?? "";
    const source = jobs.find(
      (other) => other.file === job.file && other.name === name
    );
    return source !== undefined && source.picker && job.needs.includes(name);
  });
}

/** Whether a job reads a picker output with no fallback, which leaves `runs-on` empty when the picker gives none. */
const lacksFallback = (job: Job): boolean =>
  job.units.some((unit) => unit.search(OUTPUT_REF) >= 0 && !hasFallbacks(unit));

/**
 * Whether every unit of a job that names the pool is routed. A matrix leg may
 * read its own picker; a matrix value that names the pool without one is a
 * label used directly.
 */
const routed = (job: Job, jobs: readonly Job[]): boolean =>
  job.units.every(
    (unit) => !POOL_TARGET.test(unit) || routedUnit(unit, job, jobs)
  );

/** The visibility REPOSITORY_FILE records, or why it cannot be read. */
async function visibilityOf(
  ctx: RuleContext
): Promise<{ visibility: string } | { problem: string }> {
  const text = await ctx.readFile(REPOSITORY_FILE).catch(() => null);
  if (text === null) return { problem: `${REPOSITORY_FILE} is missing` };
  let declared: unknown;
  try {
    declared = JSON.parse(text);
  } catch (error) {
    return {
      problem: `${REPOSITORY_FILE} is not valid JSON (${String(error)})`,
    };
  }
  const visibility = isMapping(declared)
    ? field(declared, "visibility")
    : undefined;
  return visibility === "public" ||
    visibility === "private" ||
    visibility === "internal"
    ? { visibility }
    : {
        problem: `${REPOSITORY_FILE} does not record "visibility" as public, private or internal`,
      };
}

export default {
  rules: {
    "picker-pin": {
      description:
        "Runner pickers are barretotech/runner-picker pinned to a full commit SHA",
      async check(ctx) {
        for (const step of (await load(ctx)).steps) {
          const match = PICKER_REF.exec(step.uses);
          if (!match) continue;
          const [, owner = "", repository = "", subpath = "", ref = ""] = match;
          if (
            `${owner}/${repository}`.toLowerCase() !== PICKER_ACTION ||
            subpath !== "" ||
            !COMMIT_SHA.test(ref)
          ) {
            ctx.report.violation({
              message: `${step.uses} is not ${PICKER_ACTION} pinned to a full commit SHA`,
              file: step.file,
              line: step.line,
              fix: `uses: ${PICKER_ACTION}@<40-character SHA of the release> # vX.Y.Z`,
            });
          }
        }
      },
    },
    "picker-service": {
      description:
        "Each picker step asks the capacity service through the tailnet",
      async check(ctx) {
        for (const step of (await load(ctx)).steps) {
          if (!PICKER_REF.test(step.uses)) continue;
          for (const [input, expected] of REQUIRED_INPUTS) {
            const value = step.with[input];
            if (typeof value !== "string" || !expected.test(value.trim())) {
              ctx.report.violation({
                message: `The runner picker step's \`with: ${input}\` is not set as the ci-runners ADR requires`,
                file: step.file,
                line: step.line,
                fix: "Under the step's `with:`, set `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`",
              });
            }
          }
        }
      },
    },
    "routed-runs-on": {
      description:
        "Jobs reach the shared pool or Blacksmith only through a picker job's output, unless marked exempt",
      async check(ctx) {
        const { jobs, unreadable } = await load(ctx);
        for (const { file, error } of unreadable) {
          ctx.report.violation({
            message: `${file} could not be read as YAML, so its runners are unchecked (${error})`,
            file,
            fix: "Fix the YAML syntax",
          });
        }
        for (const job of jobs) {
          if (job.exempt) continue;
          const unrouted = targetsPool(job) && !routed(job, jobs);
          if (!unrouted && !lacksFallback(job)) continue;
          ctx.report.violation({
            message: unrouted
              ? `Job \`${job.name}\` targets the self-hosted pool or Blacksmith without taking its runner from a picker job it needs`
              : `Job \`${job.name}\` reads a picker output with no fallback, so it has no runner when the picker gives none`,
            file: job.file,
            line: job.line,
            fix: "runs-on: ${{ fromJSON(needs.<picker job>.outputs.runs-on || <fallback>) }}, with the picker job in `needs`. A job whose purpose is the self-hosted machine itself carries `# runner-picker: exempt - <reason>` on the line before runs-on.",
          });
        }
      },
    },
    "public-hosted-only": {
      description:
        "A public repository uses neither the runner picker nor a self-hosted or Blacksmith runner",
      async check(ctx) {
        const record = await visibilityOf(ctx);
        if ("problem" in record) {
          ctx.report.violation({
            message: `${record.problem}, so the public-repository rule cannot be checked`,
            file: REPOSITORY_FILE,
            fix: 'Write { "visibility": "public" | "private" | "internal" } as GitHub reports it; the enterprise-adrs Sync workflow keeps the file current',
          });
          return;
        }
        if (record.visibility !== "public") return;
        const { steps, jobs } = await load(ctx);
        for (const step of steps.filter((item) => PICKER_REF.test(item.uses))) {
          ctx.report.violation({
            message: "A public repository does not use the runner picker",
            file: step.file,
            line: step.line,
            fix: "Run the job on a GitHub-hosted runner such as ubuntu-latest",
          });
        }
        for (const job of jobs.filter((item) => targetsPool(item))) {
          ctx.report.violation({
            message: `Job \`${job.name}\` of a public repository targets a self-hosted or Blacksmith runner`,
            file: job.file,
            line: job.line,
            fix: "Run the job on a GitHub-hosted runner such as ubuntu-latest",
          });
        }
      },
    },
  },
} satisfies RuleSet;
