# Bug fix record: launcher crash on failed project start (Windows)

Keep this for reference when syncing the fix to another machine — just
`git pull origin main` there, this file documents *why* in case history
gets rewritten or the commit needs to be reconstructed by hand.

## Symptom

Clicking "Start" on Pithagoras / Understory / AgentBox in the dashboard
(`POST /api/start/:id`) crashed the **entire launcher process**, not just
the target sub-project. The dashboard itself went down and had to be
manually restarted.

## Timeline of the bug and fixes

### Bug #1 (original, pre-`6d6bec1`)

`server.js` called:

```js
const proc = spawn(proj.cmd, args, { cwd: proj.dir, stdio: 'inherit', env });
```

On Windows, `npm`/`pnpm` are `.cmd` shims, not real executables. `spawn()`
without `shell: true` can't resolve them, so it emits an async `'error'`
event (`ENOENT`). No `proc.on('error', ...)` listener existed, so Node
treated it as an **unhandled `'error'` event**, which is fatal by design
in Node's `EventEmitter` and crashed the process.

Reproduced crash log:
```
node:events:487
      throw er; // Unhandled 'error' event
Error: spawn npm ENOENT
    errno: -4058, code: 'ENOENT', syscall: 'spawn npm'
```

**Fix applied in commit `6d6bec1`** ("Fix: handle spawn errors gracefully
and use shell on Windows for npm/pnpm"):
- Added `shell: process.platform === 'win32'` to the spawn options.
- Added a `proc.on('error', ...)` handler that logs and sends a 500
  response.

### Bug #2 (introduced by the `6d6bec1` fix, fixed in `218da0d`)

The `6d6bec1` fix still crashed the server, via a new path. The handler
sends the **success** response synchronously, immediately after calling
`spawn()`:

```js
const proc = spawn(proj.cmd, args, spawnOpts);
processes[req.params.id] = proc;
proc.on('exit', () => { delete processes[req.params.id]; });
proc.on('error', (err) => {
  res.status(500).json({ error: ... });   // <-- second response
});
res.json({ success: true, message: `${proj.name} starting...` }); // <-- first response, sent same tick
```

`spawn()`'s `'error'` event is always asynchronous (fires on a later
tick), but `res.json(success)` runs synchronously right after `spawn()`
returns — before the error can possibly have fired yet. So by the time
the error handler runs, Express has **already sent the success
response's headers**. Calling `res.status(500).json(...)` a second time
throws `ERR_HTTP_HEADERS_SENT`, which is again uncaught and crashes the
whole server — same failure mode as bug #1, different trigger.

Reproduced crash log (in two independent environments — Git Bash and a
native PowerShell-launched `node` process, to rule out an environment
artifact):
```
Failed to start Pithagoras: spawn C:\WINDOWS\system32\cmd.exe ENOENT
node:_http_outgoing:682
    throw new ERR_HTTP_HEADERS_SENT('set');
Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
```

**Fix applied in commit `218da0d`** ("Fix crash when spawn error arrives
after success response already sent"):

```js
let responded = false;

proc.on('exit', () => {
  delete processes[req.params.id];
});

proc.on('error', (err) => {
  console.error(`Failed to start ${proj.name}:`, err.message);
  delete processes[req.params.id];
  if (!responded) {
    responded = true;
    res.status(500).json({ error: `Failed to start ${proj.name}: ${err.message}` });
  }
});

if (!responded) {
  responded = true;
  res.json({ success: true, message: `${proj.name} starting...` });
}
```

A `responded` guard ensures only the first outcome — success (sent
synchronously) or a later async error — actually writes an HTTP
response. This does not "fix" the race itself (the client can still get
a `200 success` for a project that then immediately fails to spawn —
that is a UX limitation inherent to responding before spawn is known to
have succeeded), but it eliminates the crash: the server now stays up
and keeps serving requests after any number of failed spawns. Verified
by making two consecutive failed start calls and confirming the server
still answered `GET /api/projects` afterward.

## Known remaining issue (not fixed, out of scope for this record)

Even with `shell: true`, spawn attempts in this environment failed with
`spawn C:\WINDOWS\system32\cmd.exe ENOENT` — i.e. the shell itself
couldn't be spawned. Root cause not yet investigated; may be
environment/PATH-specific (`COMSPEC`/`System32` not on `PATH` in the
shell this was tested from) rather than a bug in the launcher. Confirm
on a normal interactive Windows session (double-clicking `npm start` /
running from a normal `cmd.exe` or PowerShell terminal) before assuming
it's a real bug. Separately, `server.js` still hardcodes
`/home/roger/...` paths for all four sub-projects and the models folder
— those must be edited manually for any given machine; the README does
not mention this (documented separately in the README review).

## Commits

- `6d6bec1` — shell:true + error handler (partial fix, introduced bug #2)
- `218da0d` — `responded` guard (fixes bug #2, complete fix for the crash)

Both are pushed to `origin/main`. On the other machine:
```
git pull origin main
```
