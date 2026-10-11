# Optional Mac login startup

Copy the guard script to private application support, use `utmctl list` to find your own VM UUID, and fill the absolute path/URL/UUID placeholders in the example. Never include provider tokens in this plist. Save your configured copy under `~/Library/LaunchAgents/com.alfred.ha-guard.plist`, run `plutil -lint` and load with `launchctl bootstrap gui/$(id -u) ...` while logged in. Inspect private logs and verify it does not restart an online VM.

For Ollama/router startup use a separate user LaunchAgent with absolute binary/script/config paths, `RunAtLoad` and an appropriate restart policy. Store its random key in a mode-600 JSON file, not process arguments or a public plist. Tailscale uses its supported login-startup setting. Do not duplicate active services or keep an obsolete Node Alfred server running.

Login agents require a user session. FileVault cold boot and host power recovery are separate constraints; read the Mac setup guide before unattended use.
