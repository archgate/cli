/// <reference path="../rules.d.ts" />

/** The one picker action the enterprise uses. */
const PICKER_ACTION = "barretotech/runner-picker";
/** Any runner-picker action reference, with or without a subpath: owner, repository, subpath, ref. */
const PICKER_REF = /^([\w.-]+)\/(runner-picker)((?:\/[^@]*)?)@(.+)$/iu;
/** A full commit SHA. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
/** A runner label or expression that targets the shared pool or Blacksmith. */
const POOL_TARGET =
  /\bself-hosted\b|\btatuicloud[\w-]*|\bblacksmith-[\w.-]+|\bvars\.\w*RUNNER\w*/iu;
/** A `runs-on` that is the picker output, alone or as the first operand of a fallback. */
const ROUTED =
  /^\$\{\{\s*(?:fromJSON\(\s*)?needs\.([\w-]+)\.outputs\.runs-on\s*(?:\|\||\)|\}\})/iu;
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
  runsOn: string;
  line: number;
  exempt: boolean;
  needs: string[];
  picker: boolean;
};

const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every string inside a YAML value, however deep. */
function strings(value: Yaml | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item));
  if (isMapping(value))
    return Object.values(value).flatMap((item) => strings(item));
  return value === null || value === undefined ? [] : [String(value)];
}

/** The 1-based line of the first line at or after `from` that matches `pattern`, or 1. */
function lineOf(lines: string[], pattern: RegExp, from = 0): number {
  for (let index = from; index < lines.length; index++)
    if (pattern.test(lines[index] ?? "")) return index + 1;
  return 1;
}

/** The text of a `runs-on` value, as one string. */
function runsOnText(value: Yaml | undefined): string {
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value ?? "");
}

/** The values a `runs-on` takes from the job's matrix, including `include` entries. */
function matrixValues(runsOn: string, strategy: Yaml | undefined): string[] {
  const matrix = isMapping(strategy) ? strategy["matrix"] : undefined;
  if (!isMapping(matrix)) return [];
  const keys = [...runsOn.matchAll(MATRIX_VALUE)].map(
    (match) => match[1] ?? ""
  );
  const listed = matrix["include"];
  const include = Array.isArray(listed) ? listed : [];
  return keys.flatMap((key) =>
    strings(matrix[key]).concat(
      include.flatMap((entry) => (isMapping(entry) ? strings(entry[key]) : []))
    )
  );
}

/** The workflow and composite-action files of the repository, read once. */
async function load(ctx: RuleContext): Promise<{ steps: Step[]; jobs: Job[] }> {
  const files = ctx.scopedFiles.filter((file) => /\.ya?ml$/u.test(file));
  const parsed = await Promise.all(
    files.map(async (file) => {
      const content: Yaml = (await ctx.readYAML(file)).content;
      return {
        file,
        lines: (await ctx.readFile(file)).split(/\r?\n/u),
        content,
      };
    })
  );
  const steps: Step[] = [];
  const jobs: Job[] = [];
  for (const { file, lines, content } of parsed) {
    if (!isMapping(content)) continue;
    const collect = (list: Yaml | undefined): Step[] =>
      (Array.isArray(list) ? list : []).flatMap((step) => {
        if (!isMapping(step)) return [];
        const uses = step["uses"];
        if (typeof uses !== "string") return [];
        const inputs = step["with"];
        const escaped = uses.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
        return [
          {
            file,
            line: lineOf(lines, new RegExp(`uses:\\s*["']?${escaped}`, "u")),
            uses: uses.trim(),
            with: isMapping(inputs) ? inputs : {},
          },
        ];
      });
    const runs = content["runs"];
    if (isMapping(runs)) steps.push(...collect(runs["steps"]));
    const declaredJobs = content["jobs"];
    if (!isMapping(declaredJobs)) continue;
    for (const [name, job] of Object.entries(declaredJobs)) {
      if (!isMapping(job)) continue;
      const jobSteps = collect(job["steps"]);
      steps.push(...jobSteps);
      const jobLine = lineOf(
        lines,
        new RegExp(
          `^\\s+${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:\\s*(?:#.*)?$`,
          "u"
        )
      );
      const runsOnLine = lineOf(lines, /^\s*runs-on:/u, jobLine);
      const runsOn = runsOnText(job["runs-on"]);
      jobs.push({
        file,
        name,
        runsOn: [runsOn, ...matrixValues(runsOn, job["strategy"])].join("\n"),
        line: runsOnLine,
        exempt: runsOnLine > 1 && EXEMPT.test(lines[runsOnLine - 2] ?? ""),
        needs: strings(job["needs"]),
        picker: jobSteps.some((step) => PICKER_REF.test(step.uses)),
      });
    }
  }
  return { steps, jobs };
}

/** Whether the repository declares itself public in REPOSITORY_FILE. */
async function isPublic(ctx: RuleContext): Promise<boolean> {
  const declared = await ctx.readJSON(REPOSITORY_FILE).catch(() => null);
  return isMapping(declared) && declared["visibility"] === "public";
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
                message: `The runner picker step's \`with: ${input}\` is not set as ARCH-001 requires`,
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
        const { jobs } = await load(ctx);
        for (const job of jobs) {
          if (!POOL_TARGET.test(job.runsOn) || job.exempt) continue;
          const routedJob = ROUTED.exec(job.runsOn.split("\n")[0] ?? "")?.[1];
          const picker =
            routedJob === undefined
              ? undefined
              : jobs.find(
                  (other) => other.file === job.file && other.name === routedJob
                );
          if (
            picker !== undefined &&
            picker.picker &&
            job.needs.includes(picker.name)
          )
            continue;
          ctx.report.violation({
            message: `Job \`${job.name}\` targets the self-hosted pool or Blacksmith without taking its runner from a picker job it needs`,
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
        if (!(await isPublic(ctx))) return;
        const { steps, jobs } = await load(ctx);
        for (const step of steps.filter((item) => PICKER_REF.test(item.uses))) {
          ctx.report.violation({
            message: "A public repository does not use the runner picker",
            file: step.file,
            line: step.line,
            fix: "Run the job on a GitHub-hosted runner such as ubuntu-latest",
          });
        }
        for (const job of jobs.filter((item) =>
          POOL_TARGET.test(item.runsOn)
        )) {
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
