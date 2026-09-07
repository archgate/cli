// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import {
  formatCredentialResponse,
  parseCredentialRequest,
} from "../../src/helpers/git-credential-protocol";

describe("parseCredentialRequest", () => {
  test("reads the key=value block git writes", () => {
    const request = parseCredentialRequest(
      "protocol=https\nhost=plugins.archgate.dev\npath=archgate.git\n\n"
    );

    expect(request).toEqual({
      protocol: "https",
      host: "plugins.archgate.dev",
      path: "archgate.git",
    });
  });

  test("stops at the first blank line", () => {
    const request = parseCredentialRequest(
      "host=plugins.archgate.dev\n\nhost=evil.example.com\n"
    );

    expect(request.host).toBe("plugins.archgate.dev");
  });

  test("keeps '=' inside a value", () => {
    const request = parseCredentialRequest("password=a=b=c\n");

    expect(request.password).toBe("a=b=c");
  });

  test.each(["", "\n", "novalue\n", "=leading\n"])(
    "yields no usable pairs for %p",
    (input) => {
      expect(parseCredentialRequest(input)).toEqual({});
    }
  );
});

describe("formatCredentialResponse", () => {
  test("emits one newline-terminated pair per field", () => {
    const output = formatCredentialResponse({
      protocol: "https",
      host: "plugins.archgate.dev",
      username: "octocat",
      password: "ey.token",
    });

    // The trailing blank line is the protocol's terminator.
    expect(output).toBe(
      "protocol=https\nhost=plugins.archgate.dev\nusername=octocat\npassword=ey.token\n\n"
    );
  });

  // A newline in a value would let it forge further protocol lines, so such a
  // field is dropped rather than emitted.
  test.each([
    ["password", "tok\nhost=evil.example.com"],
    ["username", "user\0root"],
  ])("drops %s when the value can forge protocol lines", (key, value) => {
    const output = formatCredentialResponse({ host: "h", [key]: value });

    expect(output).toBe("host=h\n\n");
  });
});
