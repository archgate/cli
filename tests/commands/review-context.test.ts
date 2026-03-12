import { describe, expect, test } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { registerReviewContextCommand } from "../../src/commands/review-context";

describe("registerReviewContextCommand", () => {
  test("registers 'review-context' as a subcommand", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    expect(sub.description()).toBeTruthy();
  });

  test("has --staged option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--staged");
  });

  test("has --run-checks option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--run-checks");
  });

  test("has --domain option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--domain");
  });
});
