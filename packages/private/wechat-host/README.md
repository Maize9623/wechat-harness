---
description: "Private WeChat Desktop host routes and the isolated 3191 group-chat sidecar."
kind: "package-reference"
---

# @ainfinity/dsh-wechat-host

## Summary

This private package mounts file, schedule, service, current-key usage, model-channel status, webpage-preview, and group-chat launch routes on the official Desktop Host and starts a fresh group-chat sidecar on 3191. Those `/api/diy-*` routes use Connection cookie authentication because Electron strips Origin. `GET /api/diy-collab-entry` reports whether 3191 is listening and the loopback URL, including a first-run setup token when the sidecar has no host owner yet. The sidecar page bundles the current WeChat shell (`node scripts/build-collab-ui.mjs`) so group-chat windows keep the same drag, preview, and conversation chrome as the single-user Desktop window. Usage reads the process `DEEPSEEK_API_KEY` against official `/user/balance`, and the ChatGPT Codex grant against `/backend-api/wham/usage` for remaining percent, reset time, and available resets. It never echoes tokens. `/api/diy-model-access` reports DeepSeek API Key status and ChatGPT Codex subscription login, rotates the DeepSeek key, and starts or cancels the official `openai-codex` OAuth flow without echoing secrets. `/api/diy-skills` lists Host `ctx.skills` together with a Node scan of `~/.agents/skills`, `$DSH_HOME/skills`, and optional project skill directories, and installs a pasted `SKILL.md` or skill URL into `~/.agents/skills`; it never executes `install.sh`. `/api/diy-browse` probes frame policy and rewrites public HTML so iframe preview can load pages that send `X-Frame-Options`, and the rewrite forwards Escape to the overlay so immersive mode can close while the guest page has focus. No runtime invariant companion is published because the sidecar is fork-only preview infrastructure, not a shipped Host contract.

## Known Limitations and Deferred Work

- The first group-chat AI path still uses HTTP RPC against the Desktop Host on 19387; an in-process bridge can replace that later.
