---
description: "Private WeChat Desktop host routes and the isolated 3191 group-chat sidecar."
kind: "package-reference"
---

# @ainfinity/dsh-wechat-host

## Summary

This private package mounts file, schedule, service, current-key usage, model-key status, webpage-preview, and group-chat launch routes on the official Desktop Host and starts a fresh group-chat sidecar on 3191. Those `/api/diy-*` routes use Connection cookie authentication because Electron strips Origin. `GET /api/diy-collab-entry` reports whether 3191 is listening and the loopback URL, including a first-run setup token when the sidecar has no host owner yet. The sidecar page bundles the current WeChat shell (`node scripts/build-collab-ui.mjs`) so group-chat windows keep the same drag, preview, and conversation chrome as the single-user Desktop window. Usage reads only the process `DEEPSEEK_API_KEY` against official `/user/balance`. `/api/diy-model-access` reports and rotates that same key without echoing the secret. `/api/diy-browse` probes frame policy and rewrites public HTML so iframe preview can load pages that send `X-Frame-Options`, and the rewrite forwards Escape to the overlay so immersive mode can close while the guest page has focus. No runtime invariant companion is published because the sidecar is fork-only preview infrastructure, not a shipped Host contract.

## Known Limitations and Deferred Work

- The first group-chat AI path still uses HTTP RPC against the Desktop Host on 19387; an in-process bridge can replace that later.
