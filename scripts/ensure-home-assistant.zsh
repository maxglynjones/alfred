#!/bin/zsh
# Optional VM startup guard. Provide private values through LaunchAgent environment variables.
set -eu
umask 077
task_utmctl=${ALFRED_UTMCTL:-/Applications/UTM.app/Contents/MacOS/utmctl}
task_vm=${ALFRED_HA_VM_ID:-}
task_url=${ALFRED_HA_URL:-}
task_state_dir=${ALFRED_STATE_DIR:-"$HOME/Library/Application Support/Alfred"}
if [[ -z "$task_vm" || -z "$task_url" ]]; then print -u2 'Optional HA guard is not configured. Set ALFRED_HA_VM_ID and ALFRED_HA_URL in its LaunchAgent.'; exit 0; fi
mkdir -p "$task_state_dir"
task_status=$($task_utmctl status "$task_vm")
case "$task_status" in
 stopped|suspended) "$task_utmctl" start "$task_vm" --hide; print '{"status":"starting"}' > "$task_state_dir/home-health.json"; exit 0 ;;
 starting|stopping|pausing|paused|resuming|saving) print '{"status":"transition-or-paused"}' > "$task_state_dir/home-health.json"; exit 0 ;;
 started) ;;
 *) print -u2 "Home Assistant VM state: $task_status"; exit 1 ;;
esac
task_http=$(/usr/bin/curl --max-time 3 --silent --output /dev/null --write-out '%{http_code}' "$task_url/api/" || true)
if [[ "$task_http" == 200 || "$task_http" == 401 ]]; then print '{"status":"online"}' > "$task_state_dir/home-health.json"; else print '{"status":"http-unavailable","forced_reboot":false}' > "$task_state_dir/home-health.json"; fi
