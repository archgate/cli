import type { AdrDomain } from "../formats/adr";

export function generateExampleAdr(projectName: string): string {
  return `---
id: GEN-001
title: Example Architecture Decision
domain: general
rules: false
---

# Example Architecture Decision

## Context

This is an example ADR for the ${projectName} project. Replace this with a real architecture decision.

ADRs capture important architectural decisions along with their context and consequences. Each ADR should be a short document that addresses a single decision.

## Decision

Describe the architectural decision that was made.

## Do's and Don'ts

### Do

- Keep ADRs focused on a single decision
- Include context about why the decision was made
- Update the ADR if the decision changes

### Don't

- Don't combine multiple decisions in one ADR
- Don't leave outdated ADRs in the repository; remove them when no longer relevant

## Consequences

### Positive

- Consistent documentation of architectural decisions
- Searchable history of why decisions were made

### Negative

- Requires discipline to maintain

### Risks

- ADRs may become outdated if not reviewed regularly

## Compliance and Enforcement

This example ADR has no automated rules. Set \`rules: true\` and create a companion \`.rules.ts\` file to add automated checks.

## References

- [ADR format specification](https://archgate.dev/docs/adr-format)
`;
}

interface AdrTemplateOptions {
  id: string;
  title: string;
  domain: AdrDomain;
  files?: string[];
}

export function generateAdrTemplate(options: AdrTemplateOptions): string {
  const filesLine = options.files?.length
    ? `files: [${options.files.map((f) => `"${f}"`).join(", ")}]`
    : "";

  return `---
id: ${options.id}
title: ${options.title}
domain: ${options.domain}
rules: false${filesLine ? "\n" + filesLine : ""}
---

# ${options.title}

## Context

Describe the context and problem statement.

## Decision

Describe the decision that was made.

## Do's and Don'ts

### Do

-

### Don't

-

## Consequences

### Positive

-

### Negative

-

### Risks

-

## Compliance and Enforcement

Describe how this decision will be enforced.

## References

-
`;
}
