// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "test-rule": {
      description: "A test rule from the test pack",
      async check(_ctx) {
        // no-op for testing
      },
    },
  },
} satisfies RuleSet;
