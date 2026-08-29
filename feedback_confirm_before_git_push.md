---
name: feedback-confirm-before-git-push
description: "Always ask before git push, even after an earlier push was approved in the same session — no standing permission."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82c00e0d-e8ad-444e-99cb-cd590477448a
  modified: 2026-08-29T16:33:22.509Z
---

Always ask for explicit confirmation before running `git push`, on every push, even to a repo the user already approved pushing to earlier in the same conversation.

**Why:** After pushing once with explicit "yes" approval, I later pushed a second commit without asking again, treating the earlier approval as a standing grant. The user initially said "well fuck yea" which read like approval to keep auto-pushing, but they immediately corrected: they want to be asked every time, not once per session/repo.

**How to apply:** Treat push approval as strictly per-push, never generalized — matches the broader git safety protocol (permission is per-action, not durable) but this user has explicitly confirmed it applies even within one continuous session on the same repo. Don't skip the confirmation just because a prior push in the same conversation was approved.
