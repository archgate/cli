# Plugin Distribution Plan: Closed Beta

## Overview

The archgate Claude Code plugin is distributed through a **custom git-compatible service** at `plugins.archgate.dev`. The service embeds the plugin files in a Bun single-file executable and implements just enough of the git smart HTTP protocol for `git clone` to work. Access is controlled via per-user tokens stored in a KV database.

This approach gives full control over who can access the plugin during closed beta — individual token generation, instant revocation, and download analytics — without GitHub licensing costs.

The plugin lives in a separate repository (`archgate/claude-code-plugin`) alongside this distribution service.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  plugins.archgate.dev (Railway)                 │
│                                                 │
│  Bun single-file executable                     │
│  ├── Hono HTTP server                           │
│  ├── Git smart HTTP protocol (virtual repo)     │
│  ├── Embedded plugin files (baked in at build)  │
│  ├── Token auth middleware                      │
│  └── KV store (token → user mapping)            │
└─────────────────────────────────────────────────┘

Beta user flow:
1. Sign up at archgate.dev/beta
2. Receive unique token
3. /plugin marketplace add https://<token>@plugins.archgate.dev/archgate.git
4. /plugin install archgate-governance@archgate
```

---

## 1. Git Smart HTTP Protocol

Claude Code fetches plugins via `git clone`. The git smart HTTP protocol requires only two endpoints:

### Discovery endpoint

```
GET /info/refs?service=git-upload-pack
```

Returns the current commit SHA and server capabilities. Response format:

```
001e# service=git-upload-pack
0000
<pkt-line: SHA capabilities\n>
0000
```

### Upload pack endpoint

```
POST /git-upload-pack
```

Client sends `want <SHA>` lines, server responds with `NAK` + packfile containing all objects.

### Git objects (generated at startup from embedded files)

For a single-commit virtual repo, we need three object types:

| Object     | Format                                            | Purpose                             |
| ---------- | ------------------------------------------------- | ----------------------------------- |
| **Blob**   | `blob <size>\0<content>`                          | Each plugin file's content          |
| **Tree**   | `tree <size>\0<mode> <name>\0<20-byte-SHA>...`    | Directory structure                 |
| **Commit** | `commit <size>\0tree <SHA>\nauthor...\n\nmessage` | Single commit pointing to root tree |

The **packfile** bundles all objects:

```
PACK + version(4 bytes) + object_count(4 bytes) + [deflated objects...] + SHA1 checksum
```

### Implementation

All git objects and the packfile are **pre-computed once at startup** from the embedded plugin files. Each request just serves the pre-built responses — no per-request computation.

```typescript
// Pseudo-code for the virtual git repo
class VirtualGitRepo {
  private commitSha: string;
  private packData: Uint8Array;
  private infoRefsResponse: Uint8Array;

  constructor(files: Map<string, Uint8Array>) {
    // 1. Create blob objects for each file
    // 2. Build tree objects for directory structure
    // 3. Create a single commit object
    // 4. Generate packfile containing all objects
    // 5. Pre-build the info/refs response
  }

  getInfoRefs(): Uint8Array {
    return this.infoRefsResponse;
  }
  getUploadPack(request: Uint8Array): Uint8Array {
    return this.packData;
  }
}
```

Estimated implementation: ~200-300 lines for the git protocol layer. No external git dependencies — just SHA1 hashing and zlib deflation (both built into Bun).

---

## 2. Embedded Plugin Files

The plugin files are embedded in the compiled binary at build time using Bun's import attributes:

```typescript
// src/embedded-plugin.ts
const PLUGIN_FILES = {
  ".claude-plugin/plugin.json": await import("./plugin/plugin.json", {
    with: { type: "file" },
  }),
  ".claude-plugin/marketplace.json": await import("./plugin/marketplace.json", {
    with: { type: "file" },
  }),
  "settings.json": await import("./plugin/settings.json", {
    with: { type: "file" },
  }),
  ".mcp.json": await import("./plugin/.mcp.json", { with: { type: "file" } }),
  "agents/developer.md": await import("./plugin/agents/developer.md", {
    with: { type: "file" },
  }),
  "skills/architect/SKILL.md": await import(
    "./plugin/skills/architect/SKILL.md",
    { with: { type: "file" } }
  ),
  "skills/quality-manager/SKILL.md": await import(
    "./plugin/skills/quality-manager/SKILL.md",
    { with: { type: "file" } }
  ),
  "skills/adr-author/SKILL.md": await import(
    "./plugin/skills/adr-author/SKILL.md",
    { with: { type: "file" } }
  ),
};
```

At startup, these files are used to build the virtual git repo. When the plugin is updated, the binary is rebuilt and redeployed.

---

## 3. Token Management

### KV Store

Tokens are stored in a key-value database. Options for Railway:

| Option                     | Pros                                                  | Cons                 |
| -------------------------- | ----------------------------------------------------- | -------------------- |
| **Redis (Railway plugin)** | Fast, built-in TTL, pub/sub for events                | ~$5/mo extra         |
| **SQLite (embedded)**      | Free, no external service, works with persistent disk | Needs Railway volume |
| **Upstash Redis**          | Serverless, generous free tier, REST API              | External dependency  |

Recommended: **Redis via Railway plugin** for simplicity and native TTL support.

### Token schema

```
Key:   token:<uuid>
Value: {
  userId: string,        // email or identifier
  createdAt: string,     // ISO timestamp
  expiresAt?: string,    // optional expiry
  revoked: boolean,
  lastUsedAt?: string,   // track activity
  downloadCount: number  // analytics
}
```

### Token operations

| Operation | Endpoint                      | Description                         |
| --------- | ----------------------------- | ----------------------------------- |
| Generate  | `POST /api/tokens`            | Create token for approved beta user |
| Validate  | (internal)                    | Check token on every git request    |
| Revoke    | `DELETE /api/tokens/:id`      | Instant revocation                  |
| List      | `GET /api/tokens`             | Admin view of all active tokens     |
| Rotate    | `POST /api/tokens/:id/rotate` | Generate new token, invalidate old  |

### Auth flow

```typescript
// Middleware: extract token from git HTTP auth
app.use("/archgate.git/*", async (c, next) => {
  // Git sends credentials via Basic auth: username=token, password=x-oauth-basic
  // Or: https://<token>@plugins.archgate.dev/archgate.git
  const auth = c.req.header("Authorization");
  const token = extractToken(auth); // parse Basic auth

  const record = await kv.get(`token:${token}`);
  if (!record || record.revoked) {
    return c.text("Unauthorized", 401);
  }

  // Update analytics
  await kv.set(`token:${token}`, {
    ...record,
    lastUsedAt: new Date().toISOString(),
    downloadCount: record.downloadCount + 1,
  });

  await next();
});
```

---

## 4. HTTP Routes

### Hono app structure

```typescript
import { Hono } from "hono";

const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Git protocol (auth required)
app.get("/archgate.git/info/refs", authMiddleware, (c) => {
  // Return pre-computed info/refs response
  c.header("Content-Type", "application/x-git-upload-pack-advertisement");
  return c.body(repo.getInfoRefs());
});

app.post("/archgate.git/git-upload-pack", authMiddleware, (c) => {
  // Return pre-computed packfile
  c.header("Content-Type", "application/x-git-upload-pack-result");
  return c.body(repo.getUploadPack());
});

// Admin API (separate auth — API key or admin token)
app.post("/api/tokens", adminAuth, handleCreateToken);
app.get("/api/tokens", adminAuth, handleListTokens);
app.delete("/api/tokens/:id", adminAuth, handleRevokeToken);

export default app;
```

---

## 5. Build & Deploy

### Binary compilation

```bash
bun build --compile --minify --target=bun-linux-x64 \
  src/server.ts \
  --outfile=dist/archgate-plugins
```

The binary embeds:

- Hono server code
- Git protocol implementation
- All plugin files (via import attributes)
- No runtime dependencies needed

### Dockerfile

```dockerfile
FROM oven/bun:1.3-slim AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun build --compile --minify --target=bun-linux-x64 src/server.ts --outfile=dist/archgate-plugins

FROM gcr.io/distroless/base-debian12
COPY --from=builder /app/dist/archgate-plugins /archgate-plugins
EXPOSE 3000
CMD ["/archgate-plugins"]
```

### Railway deployment

- Connect GitHub repo → Railway auto-deploys on push
- Add Railway Redis plugin for token KV
- Set env vars: `REDIS_URL`, `ADMIN_API_KEY`, `PORT`
- Custom domain: `plugins.archgate.dev`

### Release process

When the plugin is updated:

1. Update plugin files in the service repo
2. Push to main → Railway rebuilds the binary (with new embedded files)
3. Service restarts with updated virtual git repo
4. Users run `/plugin marketplace update` to get the new version

---

## 6. Beta Signup Flow

### User experience

```
1. archgate.dev/beta → signup form (email, GitHub handle, use case)
2. Admin reviews and approves (or auto-approve)
3. Service generates token via POST /api/tokens
4. User receives email with:
   - Their unique token
   - Install instructions:

     # Add the archgate plugin marketplace
     /plugin marketplace add https://<token>@plugins.archgate.dev/archgate.git

     # Install the plugin
     /plugin install archgate-governance@archgate

5. Plugin auto-updates on Claude Code startup (token used for auth)
```

### Token in git URL

Git supports credentials in URLs: `https://<token>:x-oauth-basic@host/repo.git`

Claude Code stores the marketplace URL locally, so the token persists across sessions. Background auto-updates use the stored URL with the embedded token.

---

## 7. Versioning

The virtual git repo has a single branch (`main`) with one commit per plugin version. When the service is redeployed with updated plugin files:

- New commit SHA is generated (content-addressable)
- Claude Code detects the change on `/plugin marketplace update`
- Users get the latest version

For version tracking, the `plugin.json` includes a `version` field:

```json
{
  "name": "archgate-governance",
  "version": "0.1.0-beta.1",
  "description": "AI governance for software development"
}
```

Bump the version in `plugin.json` before each release to ensure Claude Code detects updates.

---

## 8. Monitoring & Analytics

The service tracks:

| Metric               | How                                     |
| -------------------- | --------------------------------------- |
| Active beta users    | Tokens with `lastUsedAt` in last 7 days |
| Download count       | Per-token `downloadCount`               |
| Version adoption     | Log which commit SHA was served         |
| Failed auth attempts | Log 401 responses                       |

Expose via admin API:

```
GET /api/stats → { activeUsers, totalDownloads, lastDeploy }
```

---

## 9. Implementation Phases

### Phase 0: Git protocol implementation

- [ ] Implement git object creation (blob, tree, commit) from in-memory files
- [ ] Implement packfile generation
- [ ] Implement `info/refs` and `git-upload-pack` HTTP endpoints
- [ ] Test with `git clone` against the service

### Phase 1: Service scaffolding

- [ ] Set up Bun + Hono project in `archgate/claude-code-plugin`
- [ ] Embed plugin files in the binary
- [ ] Add Redis connection for token KV
- [ ] Add auth middleware (extract token from git Basic auth)
- [ ] Add admin API for token CRUD

### Phase 2: Deployment

- [ ] Create Dockerfile
- [ ] Set up Railway project with Redis plugin
- [ ] Configure custom domain (`plugins.archgate.dev`)
- [ ] Deploy and test end-to-end clone

### Phase 3: Beta onboarding

- [ ] Build signup form at archgate.dev/beta
- [ ] Set up email delivery for tokens + install instructions
- [ ] Onboard first beta users
- [ ] Monitor and iterate

---

## Open Questions

1. **Admin UI**: Should the admin API have a simple web UI for token management, or is CLI/API enough for beta?
2. **Token format**: UUID v4? Or shorter human-readable tokens (e.g., `ag_beta_xxxxxxxxxxxx`)?
3. **Rate limiting**: Should the service rate-limit clones per token to prevent abuse?
4. **Transition to GA**: When the beta ends, what's the path? Public GitHub repo? Keep the service? Move to official Claude Code marketplace?
