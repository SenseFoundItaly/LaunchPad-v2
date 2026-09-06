#!/bin/bash
# Install (or reinstall) the daily incentivi sync as a LaunchAgent.
#
# Idempotent: safe to re-run after moving the repo or changing the schedule.
# Runs at 08:40 local. If the Mac is asleep then, launchd runs it on the next
# wake rather than skipping the day — which is the main reason this is a
# LaunchAgent and not a crontab entry.
set -euo pipefail

LABEL="tech.sensefound.grants-incentivi"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/sensefound"
HOUR="${1:-8}"
MINUTE="${2:-40}"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/grants-incentivi-daily.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <!-- Never on load: bootstrapping should not fire a sync as a side effect. -->
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG_DIR/grants-incentivi.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/grants-incentivi.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST_EOF

# bootout first so a re-run replaces cleanly; ignore "not loaded".
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

echo "installed: $PLIST"
echo "schedule : daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE") local"
echo "log      : $LOG_DIR/grants-incentivi.log"
echo
echo "run it now:   launchctl kickstart -k gui/$UID/$LABEL"
echo "check state:  launchctl print gui/$UID/$LABEL | head -20"
echo "uninstall:    launchctl bootout gui/$UID/$LABEL && rm $PLIST"
