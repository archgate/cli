/// <reference path="../rules.d.ts" />

/** A `uses:` line of any runner-picker action, with the reference after `@`. */
const PICKER_USES = /^\s*(?:-\s+)?uses:\s*["']?([\w.-]+\/runner-picker)@([^\s"'#]+)/u;
/** The one picker action the enterprise uses. */
const PICKER_ACTION = "barretotech/runner-picker";
/** A full commit SHA. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
/** A `runs-on:` line and its value. */
const RUNS_ON = /^(\s*)runs-on:\s*(.*)$/u;
/** A runner value that targets the shared pool or Blacksmith: a label or a runner variable. */
const POOL_TARGET = /\bself-hosted\b|\btatuicloud[\w-]*|\bblacksmith-[\w.-]+|\bvars\.\w*RUNNER\b/iu;
/** A runner value that reads a picker job's output. */
const PICKER_OUTPUT = /\bneeds\.[\w-]+\.outputs\.runs-on\b/u;
/** The marker of a job whose purpose is the self-hosted machine itself. */
const EXEMPT = /#\s*runner-picker:\s*exempt\b\s*[-:]\s*\S/iu;
/** The inputs a picker step must set. */
const REQUIRED_INPUTS: readonly (readonly [string, RegExp])[] = [
  ["source: service", /^\s*source:\s*["']?service["']?\s*$/mu],
  [
    "capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}",
    /^\s*capacity-url:\s*\$\{\{\s*vars\.RUNNER_CAPACITY_URL\s*\}\}\s*$/mu,
  ],
  [
    "tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}",
    /^\s*tailnet-client-id:\s*\$\{\{\s*vars\.TAILNET_CLIENT_ID_PICKER\s*\}\}\s*$/mu,
  ],
];

/** Workflow and composite-action files in scope. */
function workflowFiles(ctx: RuleContext): string[] {
  return ctx.scopedFiles.filter((file) => /\.ya?ml$/u.test(file));
}

/** The indentation of `line`. */
function depthOf(line: string): number {
  return line.match(/^\s*/u)?.[0].length ?? 0;
}

/** The text of the step whose `uses:` is at line index `at`: from its `- ` line to the next line at that depth or shallower. */
function stepBlock(lines: string[], at: number): string {
  let start = at;
  while (start > 0 && !lines[start].trimStart().startsWith("- ")) start--;
  const dash = depthOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || depthOf(lines[end]) > dash)) end++;
  return lines.slice(start, end).join("\n");
}

export default {
  rules: {
    "picker-pin": {
      description: "Runner pickers are barretotech/runner-picker pinned to a full commit SHA",
      async check(ctx) {
        for (const file of workflowFiles(ctx)) {
          const lines = (await ctx.readFile(file)).split(/\r?\n/u);
          lines.forEach((line, index) => {
            const match = line.match(PICKER_USES);
            if (!match) return;
            const [, action, ref] = match;
            if (action.toLowerCase() !== PICKER_ACTION || !COMMIT_SHA.test(ref)) {
              ctx.report.violation({
                message: `${action}@${ref} is not ${PICKER_ACTION} pinned to a full commit SHA`,
                file,
                line: index + 1,
                fix: `uses: ${PICKER_ACTION}@<40-character SHA of the release> # vX.Y.Z`,
              });
            }
          });
        }
      },
    },
    "picker-service": {
      description: "Each picker step asks the capacity service through the tailnet",
      async check(ctx) {
        for (const file of workflowFiles(ctx)) {
          const lines = (await ctx.readFile(file)).split(/\r?\n/u);
          lines.forEach((line, index) => {
            if (!PICKER_USES.test(line)) return;
            const block = stepBlock(lines, index);
            for (const [input, pattern] of REQUIRED_INPUTS) {
              if (!pattern.test(block)) {
                ctx.report.violation({
                  message: `The runner picker step does not set ${input}`,
                  file,
                  line: index + 1,
                  fix: `Add \`${input}\` under the step's \`with:\``,
                });
              }
            }
          });
        }
      },
    },
    "routed-runs-on": {
      description:
        "Jobs reach the shared pool or Blacksmith only through a picker output, unless marked exempt",
      async check(ctx) {
        for (const file of workflowFiles(ctx)) {
          const lines = (await ctx.readFile(file)).split(/\r?\n/u);
          lines.forEach((line, index) => {
            const match = line.match(RUNS_ON);
            if (!match) return;
            let value = match[2];
            // A block value: the indented lines after `runs-on:`.
            for (let i = index + 1; i < lines.length; i++) {
              const depth = lines[i].match(/^\s*/u)?.[0].length ?? 0;
              if (lines[i].trim() !== "" && depth <= match[1].length) break;
              value += `\n${lines[i]}`;
            }
            if (!POOL_TARGET.test(value) || PICKER_OUTPUT.test(value)) return;
            if (index > 0 && EXEMPT.test(lines[index - 1])) return;
            ctx.report.violation({
              message:
                "This job targets the self-hosted pool or Blacksmith without asking the runner picker",
              file,
              line: index + 1,
              fix: "Read the runner from a picker job: runs-on: ${{ fromJSON(needs.<picker>.outputs.runs-on || <fallback>) }}. A job whose purpose is the self-hosted machine itself carries `# runner-picker: exempt - <reason>` on the line before runs-on.",
            });
          });
        }
      },
    },
  },
} satisfies RuleSet;
