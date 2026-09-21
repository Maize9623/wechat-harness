---
description: "Private WeChat-style overlay for the DeepSeek Harness Desktop preview."
kind: "package-reference"
---

# @ainfinity/dsh-wechat-ui

## Summary

This private package registers a reversible WeChat-style shell over the official Desktop Web surface. It keeps official Session, Workspace, and plugin services, and does not publish a runtime invariant companion because it is a fork-only preview overlay rather than a shipped Host contract. The conversation header follows the official current Session after restart so stored avatars apply on the first paint. The conversation pane pages back to the opening human bubble when a long turn has pushed it outside the official 50-event window, and exposes 加载更早的聊天记录 when earlier pages remain. Session-list rows show the latest message without markdown marks, then a status line, and never a workspace path or persona subtitle. Webpage preview can dock, sit as a corner mini window, or go immersive. Chat filenames such as `holiday-calendar.html` open the same side preview after the overlay reads the workspace file. A Chinese display name or a Desktop copy of that page still opens the workspace HTML when it is the only page there. The page fills the current preview box and reflows when the user resizes it. Mini and immersive keep a close control outside the guest page. Browser iframe preview uses the same-origin browse rewrite so pages that send `X-Frame-Options` still load and Esc leaves immersive mode even when the guest page has focus. General Settings can store a DeepSeek API Key or start the official ChatGPT Codex device-code login; the conversation model menu groups those two channels so one session can switch without restarting, and Codex rows list stronger capability first (GPT-6 Astra, then Sol, then previous flagships, then Luna / mini / Spark). DeepSeek and Codex section titles collapse their model rows and remember that choice. Usage and fees shows DeepSeek balance plus ChatGPT Codex remaining percent, reset time, and available resets when that channel is signed in. The official Desktop profile inserts Computer Use with the native Cua Driver. The left rail opens a skill inventory that is not the plugin center; a pasted skill link in any session is installed to `~/.agents/skills` and the model is asked to teach usage. General Settings can launch the isolated group-chat sidecar in a second Desktop window on 3191; the current single-user window stays on 19387. That sidecar page uses this package's WeChat shell, not a frozen first-revision copy.

## Known Limitations and Deferred Work

- Group-chat rooms, login, and workspace ZIP download stay on the isolated 3191 sidecar.
