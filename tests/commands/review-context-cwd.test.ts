// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerReviewContextCommand } from "../../src/commands/review-context";
import * as sentry from "../../src/helpers/sentry";
import { rejectionMessage } from "../test-utils";

afterEach(() => {
  mock.restore();
});

describe("review-context working directory errors", () => {
  test.each([
    {
      name: "deleted cwd",
      error: Object.assign(new Error("uv_cwd"), {
        code: "ENOENT",
        syscall: "uv_cwd",
      }),
      code: 1,
      captures: 0,
    },
    {
      name: "unrelated internal failure",
      error: new TypeError("unexpected cwd failure"),
      code: 2,
      captures: 1,
    },
  ])(
    "handles $name at the command boundary",
    async ({ error, code, captures }) => {
      const capture = spyOn(sentry, "captureException").mockImplementation(
        () => {}
      );
      const output = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("test exit");
      });
      const program = new Command();
      registerReviewContextCommand(program);
      spyOn(process, "cwd").mockImplementation(() => {
        throw error;
      });

      expect(
        await rejectionMessage(
          program.parseAsync(["review-context"], { from: "user" })
        )
      ).toBe("test exit");
      expect(exit).toHaveBeenCalledWith(code);
      expect(capture).toHaveBeenCalledTimes(captures);
      if (code === 1) {
        expect(output.mock.calls.flat().join(" ")).toContain(
          "Change to an existing directory"
        );
      } else {
        expect(capture.mock.calls[0][0]).toBe(error);
      }
    }
  );
});
