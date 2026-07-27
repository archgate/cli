// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { InvalidArgumentError } from "@commander-js/extra-typings";

import { rejectBlank } from "../../src/helpers/cli-options";

describe("rejectBlank", () => {
  test("returns the value unchanged when non-blank", () => {
    expect(rejectBlank("my title")).toBe("my title");
  });

  test("preserves internal and trailing whitespace on an otherwise non-blank value", () => {
    expect(rejectBlank("  my title  ")).toBe("  my title  ");
  });

  test("throws InvalidArgumentError for an empty string", () => {
    expect(() => rejectBlank("")).toThrow(InvalidArgumentError);
  });

  test("throws InvalidArgumentError for a whitespace-only string", () => {
    expect(() => rejectBlank("   ")).toThrow(InvalidArgumentError);
  });
});
