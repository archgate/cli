// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { InvalidArgumentError } from "@commander-js/extra-typings";

/**
 * Commander `argParser` for any `Option` that must not accept a blank or
 * whitespace-only value. Rejects at parse time so a command's action
 * handler only needs `opts.foo !== undefined` to know the flag was both
 * passed and meaningful — no separate `!== ""` guard needed downstream.
 */
export function rejectBlank(val: string): string {
  if (val.trim() === "") {
    throw new InvalidArgumentError("must not be empty");
  }
  return val;
}
