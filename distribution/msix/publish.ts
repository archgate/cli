// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Submits a packed MSIX to the Microsoft Store as an update to the published
 * product, through the Microsoft Store submission API.
 *
 * The access token comes from the caller. In CI it is issued to a Microsoft
 * Entra application that trusts GitHub's OIDC provider, so the repository holds
 * no Partner Center secret.
 *
 * @example
 * ```bash
 * PARTNER_CENTER_ACCESS_TOKEN=... bun run publish:msstore --archive submission.zip
 * ```
 */

import { join } from "node:path";

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { z } from "zod";

import { MSIX_ARTIFACT_NAME } from "./build";
import store from "./store.json";

/** Audience an access token must be issued for. */
export const STORE_API_RESOURCE = "https://manage.devcenter.microsoft.com";

const API_ROOT = `${STORE_API_RESOURCE}/v1.0/my/applications`;

/** A stalled request fails here, well inside the job's own timeout. */
const API_TIMEOUT_MS = 60_000;

/** The archive is tens of megabytes, so its upload gets a longer allowance. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

const ApplicationSchema = z.object({
  pendingApplicationSubmission: z.object({ id: z.string() }).optional(),
});

const PackageSchema = z.looseObject({
  fileName: z.string(),
  fileStatus: z.string(),
});

const SubmissionSchema = z.looseObject({
  id: z.string(),
  fileUploadUrl: z.string(),
  applicationPackages: z.array(PackageSchema),
});

const StatusSchema = z.object({
  status: z.string(),
  statusDetails: z.unknown().optional(),
});

type Submission = z.infer<typeof SubmissionSchema>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Replaces every package of a submission with the one being uploaded. A new
 * submission is a copy of the published one, so it lists the packages of the
 * release currently in the Store.
 */
export function replacePackages(
  submission: Submission,
  packageFileName: string
): Submission {
  return {
    ...submission,
    applicationPackages: [
      ...submission.applicationPackages.map((existing) => ({
        ...existing,
        fileStatus: "PendingDelete",
      })),
      {
        fileName: packageFileName,
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      },
    ],
  };
}

/**
 * Calls the submission API and parses the JSON it returns.
 *
 * @throws If the response status is not 2xx. The body is included, since the
 * API reports the rejected field there.
 */
async function callApi<T>(
  options: { fetch: Fetch; token: string },
  request: { method: string; path: string; body?: unknown },
  schema: z.ZodType<T>
): Promise<T> {
  const response = await options.fetch(`${API_ROOT}/${request.path}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
    ...(request.body === undefined
      ? {}
      : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${request.method} ${request.path} failed with ${response.status}: ${text}`
    );
  }
  return schema.parse(text === "" ? {} : JSON.parse(text));
}

/** Commit states the Store reports while it is still accepting the upload. */
const IN_PROGRESS_STATUSES = new Set(["CommitStarted", "PendingCommit"]);

/** Commit states that mean the submission will not reach certification. */
const FAILED_STATUSES = new Set([
  "CommitFailed",
  "PreProcessingFailed",
  "Canceled",
]);

/**
 * Creates a submission holding `archive`, commits it, and waits until the Store
 * accepts or rejects the commit. Certification runs afterwards on the Store's
 * side and is not awaited.
 *
 * @param options.archive A ZIP whose root holds the package named
 * `packageFileName`.
 * @returns The submission ID and the status the Store reported last.
 * @throws If an API call fails, the Store rejects the commit, or the commit is
 * still in progress after `maxPolls` checks.
 */
export async function publishToStore(options: {
  productId: string;
  token: string;
  archive: Blob;
  packageFileName: string;
  fetch?: Fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<{ submissionId: string; status: string }> {
  const api = { fetch: options.fetch ?? fetch, token: options.token };
  const { productId } = options;

  // The Store allows one in-progress submission per product, so a draft left
  // behind by an earlier run is removed before a new one is created.
  const application = await callApi(
    api,
    { method: "GET", path: productId },
    ApplicationSchema
  );
  const pending = application.pendingApplicationSubmission;
  if (pending !== undefined) {
    await callApi(
      api,
      { method: "DELETE", path: `${productId}/submissions/${pending.id}` },
      z.unknown()
    );
  }

  const created = await callApi(
    api,
    { method: "POST", path: `${productId}/submissions` },
    SubmissionSchema
  );
  const submissionPath = `${productId}/submissions/${created.id}`;

  await callApi(
    api,
    {
      method: "PUT",
      path: submissionPath,
      body: replacePackages(created, options.packageFileName),
    },
    z.unknown()
  );

  // The upload URL is a pre-authorized Azure Blob URL: it takes no bearer
  // token, and the blob type header is mandatory.
  const upload = await api.fetch(created.fileUploadUrl, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob" },
    body: options.archive,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!upload.ok) {
    throw new Error(`Package upload failed with ${upload.status}`);
  }

  await callApi(
    api,
    { method: "POST", path: `${submissionPath}/commit` },
    z.unknown()
  );

  const maxPolls = options.maxPolls ?? 60;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- each poll depends on the previous one's result
    const { status, statusDetails } = await callApi(
      api,
      { method: "GET", path: `${submissionPath}/status` },
      StatusSchema
    );
    if (FAILED_STATUSES.has(status)) {
      throw new Error(
        `The Store rejected submission ${created.id} (${status}): ${JSON.stringify(statusDetails)}`
      );
    }
    if (!IN_PROGRESS_STATUSES.has(status)) {
      return { submissionId: created.id, status };
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential by design: wait between polls
    await Bun.sleep(options.pollIntervalMs ?? 10_000);
  }

  throw new Error(
    `Submission ${created.id} was still committing after ${maxPolls} status checks`
  );
}

interface CliOptions {
  archive: string;
  productId: string;
  packageName: string;
}

function parseProductId(value: string): string {
  if (!/^9[A-Z0-9]{11}$/u.test(value)) {
    throw new InvalidArgumentError(
      `must be a 12-character Store product ID, got "${value}"`
    );
  }
  return value;
}

/**
 * Parses the script's command-line arguments.
 *
 * @throws {CommanderError} If an option is unknown, its value is missing, or a
 * value fails validation.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  return new Command()
    .name("publish:msstore")
    .description("Submit a packed MSIX to the Microsoft Store")
    .option(
      "--archive <path>",
      "ZIP holding the package at its root",
      join("dist", "msix", "submission.zip")
    )
    .option(
      "--product-id <id>",
      "Store product ID",
      parseProductId,
      store.productId
    )
    .option(
      "--package-name <name>",
      "file name of the package inside the archive",
      MSIX_ARTIFACT_NAME
    )
    .exitOverride()
    .parse(argv, { from: "user" })
    .opts();
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const token = Bun.env.PARTNER_CENTER_ACCESS_TOKEN;
  if (token === undefined || token === "") {
    throw new Error(
      `PARTNER_CENTER_ACCESS_TOKEN is not set. It must hold an access token for ${STORE_API_RESOURCE}.`
    );
  }

  const archive = Bun.file(options.archive);
  if (!(await archive.exists())) {
    throw new Error(`Archive not found: ${options.archive}`);
  }

  const result = await publishToStore({
    productId: options.productId,
    token,
    archive,
    packageFileName: options.packageName,
  });
  console.log(
    `Submission ${result.submissionId} committed for ${options.productId}: ${result.status}`
  );
}

if (import.meta.main) {
  await main();
}
