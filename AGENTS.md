# Reefnote project operations

## Starting the app from chat

When the user asks to start Reefnote, bring up the server, or enable phone access:

- Read `config/tailscale.json` for the saved Tailscale hostname and ports. `scripts/remote.mjs` consumes this config.
- Check the configured localhost port and Tailscale HTTPS URL first. If already healthy, reuse the server. If a restart is needed, identify the Reefnote process before stopping it.
- Run `npm run remote` from this project in a persistent process session. It builds production assets, configures private Tailscale Serve, sets the matching ORIGIN, starts the app, and prevents idle sleep on macOS.
- Use network/process permissions outside the sandbox when needed; a sandbox connection failure alone does not mean the server is down.
- Verify the HTTPS URL responds successfully, and return the clickable phone URL to the user. After code changes, restart the production server so it uses the latest build.
- Keep access private to the tailnet. Use the existing `data/novel.db` and `data/secret.key`.

The Mac and phone must be signed into Tailscale. Keep the Mac awake with its lid open. Tailscale login credentials and device state remain managed by Tailscale; they are not stored in project sources.

## Managed background server

Reefnote is now run independently of chat sessions by the per-user macOS launchd job `com.reefnote.remote`. The job runs `npm run remote` in this project, retains the existing database and key, keeps access private to Tailscale, and restarts after an exit.

- Check it with `launchctl print gui/$(id -u)/com.reefnote.remote` and inspect `data/remote-service.log`.
- If this job is loaded, restart after code changes with `launchctl kickstart -k gui/$(id -u)/com.reefnote.remote`; it rebuilds through `npm run remote`. Do not start a second server or stop only its child process, since launchd will restart it.
- Its current-session launch configuration is `/tmp/reefnote-remote-501.plist`. This is not a login item; after logout or reboot, check health and start Reefnote again as needed.
- Verify the localhost and Tailscale URLs after restarting.
