// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

import { readStdinText } from "../../src/helpers/stdin";

const HELPER_URL = pathToFileURL(
  `${import.meta.dir}/../../src/helpers/stdin.ts`
).href;

async function* chunks(
  ...parts: (Uint8Array | string)[]
): AsyncGenerator<Uint8Array | string> {
  yield* parts;
}

describe("readStdinText", () => {
  test("joins string chunks", async () => {
    expect(await readStdinText(chunks("protocol=https\n", "host=h\n\n"))).toBe(
      "protocol=https\nhost=h\n\n"
    );
  });

  test("decodes a multi-byte character split across byte chunks", async () => {
    const bytes = new TextEncoder().encode("user=Zoë\n");
    const cut = bytes.indexOf(0xc3) + 1;
    expect(
      await readStdinText(chunks(bytes.slice(0, cut), bytes.slice(cut)))
    ).toBe("user=Zoë\n");
  });

  test("returns an empty string for a closed stream", async () => {
    expect(await readStdinText(chunks())).toBe("");
  });

  // The read is awaited from a promise chain that starts after module
  // evaluation ends, the shape a command action has under Commander: the
  // process must stay alive until the pipe closes rather than exit 0 with
  // the input unread.
  test("reads a piped stdin to EOF from inside a floating promise", async () => {
    const script = [
      `import(${JSON.stringify(HELPER_URL)})`,
      ".then((m) => m.readStdinText())",
      ".then((text) => { process.stdout.write(text); process.exit(0); });",
    ].join("");
    const request = "protocol=https\nhost=plugins.archgate.dev\n\n";
    const proc = Bun.spawn([process.execPath, "-e", script], {
      stdin: new Blob([request]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(request);
  });
});
