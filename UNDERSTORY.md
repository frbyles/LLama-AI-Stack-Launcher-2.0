# Running Understory outside Docker

[Understory](https://github.com/thecodacus/understory) is the memory/knowledge-graph
MCP server the "Understory" project card in this launcher points at
(`http://localhost:3800`). Its own README's quick-start is Docker Compose, where
`environment:` values are injected directly into the container. Run it from source
instead — which is what the launcher's Start button does (`pnpm dev` in the
`understory` checkout) — and there's a gap worth knowing about.

## Why a blank page / "site can't be reached" happens

Understory's server reads `BUNDLE_ROOT`, `LLM_API_BASE_URL`, `LLM_API_FORMAT`, and
`LLM_MODEL` straight from `process.env`. In Docker, Compose sets those directly, so
it works. Run it from source with only a `.env` file sitting next to `package.json`
and nothing loads it — the process exits immediately with:

```
BUNDLE_ROOT env var is required
```

The frontend (Vite dev server, port 5180 in dev mode) comes up fine and proxies API
calls to port 3800 — but nothing is listening there, so you get a blank page /
connection-refused instead of an error you can see.

## What the launcher does about it

As of this launcher version, `POST /api/start/understory` (the Start button) injects
working defaults into the child process's environment before spawning `pnpm dev`,
so it boots standalone with no manual setup:

| Var | Default the launcher injects |
| --- | --- |
| `BUNDLE_ROOT` | `<understory checkout>/my-memory` — auto-created with a minimal valid empty bundle (`index.md` + `log.md`) on first start if it doesn't exist yet |
| `LLM_API_BASE_URL` | `http://<host>:<port>/v1` — wherever this launcher's own Llama.cpp Server card is configured to listen |
| `LLM_API_FORMAT` | `openai` |
| `LLM_MODEL` | *(blank — auto-discovers whatever model llama-server currently has loaded)* |
| `PORT` | `3800` |

Any of these already set in the real environment (a shell export, or Understory's
own `.env` if you add proper loading for it) takes priority — the launcher only
fills in what's missing, never overrides.

**Prerequisite:** the Llama.cpp Server card needs to actually be running (a model
loaded) before you start Understory, since `LLM_API_BASE_URL` points at it.

## Running it without the launcher at all

If you want to run `pnpm dev` (or `node dist/index.js`) directly from a terminal
instead of through the launcher, export the vars yourself first — a bare `.env`
file next to `package.json` won't be read unless Understory's own code has been
patched to load it (see `packages/server/src/index.ts` — no `dotenv` import means
no `.env` loading):

```bash
cd understory
BUNDLE_ROOT=./my-memory \
LLM_API_BASE_URL=http://localhost:8080/v1 \
LLM_API_FORMAT=openai \
LLM_MODEL= \
pnpm --filter @understory/server dev
```

`./my-memory` needs to exist and contain at least a valid `index.md` — copying
`sample-bundle/` as a starting point works, or start from an empty bundle:

```
---
okf_version: "0.1"
---

# Knowledge Base

## Memory Segments
```

plus an empty `log.md` (`# Directory Update Log`).

## Registering it as an MCP server

Once it's actually running:

```bash
claude mcp add --transport http ustory http://localhost:3800/mcp
```

Gives any MCP client (Claude Code included) `memory_query` / `memory_add` /
`memory_update` / `memory_status` / `memory_maintain` against the bundle.
