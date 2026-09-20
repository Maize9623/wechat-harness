---
description: "Private WeChat Desktop bundle that layers the overlay and 3191 sidecar onto official Desktop."
kind: "package-reference"
---

# @ainfinity/dsh-wechat-app

## Summary

This private bundle adds the WeChat overlay and isolated group-chat sidecar to the official Desktop web profile. No runtime invariant companion is published because the bundle is a fork-only composition layer, not a shipped public contract.

## Known Limitations and Deferred Work

- Computer Use is enabled on a fresh Desktop profile by inserting `dsh-computer-use` and the native Cua Driver. A person can still remove those rows from the profile patch or disable them in Plugins.
