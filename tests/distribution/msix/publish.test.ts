// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  parseArgs,
  publishToStore,
  replacePackages,
  STORE_API_RESOURCE,
} from "../../../distribution/msix/publish";
import store from "../../../distribution/msix/store.json";

const PRODUCT = "9ABCDEFGHJKL";
const API = `${STORE_API_RESOURCE}/v1.0/my/applications/${PRODUCT}`;
const UPLOAD_URL = "https://blob.example/upload?sig=abc";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A scripted Store: answers each `METHOD url` with the next queued response and
 * records the request.
 */
function fakeStore(script: Record<string, Array<[number, unknown]>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({
      method,
      url,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the code under test only ever passes a plain header record
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });
    const next = script[`${method} ${url}`]?.shift();
    if (next === undefined) return new Response("unexpected", { status: 500 });
    const [status, payload] = next;
    return new Response(payload === undefined ? "" : JSON.stringify(payload), {
      status,
    });
  };
  return { fetch, calls };
}

function submission(id: string) {
  return {
    id,
    fileUploadUrl: UPLOAD_URL,
    applicationCategory: "DeveloperTools",
    applicationPackages: [
      { fileName: "old.msix", fileStatus: "Uploaded", version: "1.0.0.0" },
    ],
  };
}

function happyScript(statuses: string[]) {
  return {
    [`GET ${API}`]: [[200, {}]],
    [`POST ${API}/submissions`]: [[200, submission("S1")]],
    [`PUT ${API}/submissions/S1`]: [[200, {}]],
    [`PUT ${UPLOAD_URL}`]: [[201, undefined]],
    [`POST ${API}/submissions/S1/commit`]: [[202, { status: "CommitStarted" }]],
    [`GET ${API}/submissions/S1/status`]: statuses.map(
      (status): [number, unknown] => [200, { status }]
    ),
  } satisfies Record<string, Array<[number, unknown]>>;
}

async function publish(
  fetch: (url: string, init?: RequestInit) => Promise<Response>
) {
  return publishToStore({
    productId: PRODUCT,
    token: "token",
    archive: new Blob(["zip"]),
    packageFileName: "new.msix",
    fetch,
    pollIntervalMs: 0,
    maxPolls: 3,
  });
}

describe("replacePackages", () => {
  test("retires the published packages and queues the new one", () => {
    const result = replacePackages(submission("S1"), "new.msix");
    expect(result.applicationPackages).toEqual([
      { fileName: "old.msix", fileStatus: "PendingDelete", version: "1.0.0.0" },
      {
        fileName: "new.msix",
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      },
    ]);
  });

  test("keeps the rest of the submission untouched", () => {
    const result = replacePackages(submission("S1"), "new.msix");
    expect(result.applicationCategory).toBe("DeveloperTools");
    expect(result.id).toBe("S1");
  });
});

describe("publishToStore", () => {
  test("creates, fills, uploads and commits a submission", async () => {
    const { fetch, calls } = fakeStore(
      happyScript(["CommitStarted", "PreProcessing"])
    );

    expect(await publish(fetch)).toEqual({
      submissionId: "S1",
      status: "PreProcessing",
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${API}`,
      `POST ${API}/submissions`,
      `PUT ${API}/submissions/S1`,
      `PUT ${UPLOAD_URL}`,
      `POST ${API}/submissions/S1/commit`,
      `GET ${API}/submissions/S1/status`,
      `GET ${API}/submissions/S1/status`,
    ]);
  });

  test("sends the bearer token to the API but not to the upload URL", async () => {
    const { fetch, calls } = fakeStore(happyScript(["PreProcessing"]));
    await publish(fetch);

    const upload = calls.find((call) => call.url === UPLOAD_URL);
    expect(upload?.headers).toEqual({ "x-ms-blob-type": "BlockBlob" });
    expect(calls[0]?.headers.Authorization).toBe("Bearer token");
  });

  test("bounds every request with a timeout", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const { fetch } = fakeStore(happyScript(["PreProcessing"]));
    await publish(async (url, init) => {
      signals.push(init?.signal);
      return fetch(url, init);
    });

    expect(signals).toHaveLength(6);
    expect(signals.map((signal) => signal?.constructor.name)).toEqual(
      Array.from({ length: 6 }, () => "AbortSignal")
    );
  });

  test("submits the replaced package list", async () => {
    const { fetch, calls } = fakeStore(happyScript(["PreProcessing"]));
    await publish(fetch);

    const update = calls.find(
      (call) => call.method === "PUT" && call.url === `${API}/submissions/S1`
    );
    expect(update?.body).toMatchObject({
      applicationPackages: [
        { fileName: "old.msix", fileStatus: "PendingDelete" },
        { fileName: "new.msix", fileStatus: "PendingUpload" },
      ],
    });
  });

  test("deletes a pending submission before creating one", async () => {
    const script = happyScript(["PreProcessing"]);
    const { fetch, calls } = fakeStore({
      ...script,
      [`GET ${API}`]: [[200, { pendingApplicationSubmission: { id: "S0" } }]],
      [`DELETE ${API}/submissions/S0`]: [[204, undefined]],
    });
    await publish(fetch);

    expect(calls[1]).toMatchObject({
      method: "DELETE",
      url: `${API}/submissions/S0`,
    });
  });

  test("reports the API's error body", async () => {
    const { fetch } = fakeStore({
      [`GET ${API}`]: [[401, { message: "token expired" }]],
    });
    expect(publish(fetch)).rejects.toThrow(/401.*token expired/u);
  });

  test("fails when the upload is refused", async () => {
    const { fetch } = fakeStore({
      ...happyScript([]),
      [`PUT ${UPLOAD_URL}`]: [[403, undefined]],
    });
    expect(publish(fetch)).rejects.toThrow("Package upload failed with 403");
  });

  test("fails when the Store rejects the commit", async () => {
    const { fetch } = fakeStore(happyScript(["CommitFailed"]));
    expect(publish(fetch)).rejects.toThrow(/rejected submission S1/u);
  });

  test("gives up when the commit never settles", async () => {
    const { fetch } = fakeStore(
      happyScript(["CommitStarted", "CommitStarted", "CommitStarted"])
    );
    expect(publish(fetch)).rejects.toThrow("after 3 status checks");
  });
});

describe("parseArgs", () => {
  test("defaults to the built archive and the committed product", () => {
    expect(parseArgs([])).toEqual({
      archive: join("dist", "msix", "submission.zip"),
      productId: store.productId,
      packageName: "archgate-win32-x64.msix",
    });
  });

  test("accepts every option", () => {
    expect(
      parseArgs([
        "--archive",
        "a.zip",
        "--product-id",
        PRODUCT,
        "--package-name",
        "p.msix",
      ])
    ).toEqual({ archive: "a.zip", productId: PRODUCT, packageName: "p.msix" });
  });

  test("rejects a malformed product ID", () => {
    expect(() => parseArgs(["--product-id", "nope"])).toThrow();
  });
});
