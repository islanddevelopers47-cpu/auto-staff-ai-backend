---
name: screen-capture
description: Capture screenshots and list visible windows on macOS and Windows.
metadata:
  {
    "openclaw":
      {
        "emoji": "📸",
        "os": ["darwin", "win32"],
      },
  }
---

# Screen Capture

Capture screenshots and inspect visible application windows directly from the desktop.

## Available Tools

- `[[TOOL:screen_capture|filename]]` — Capture a full-screen screenshot. Filename is optional (defaults to screenshot-{timestamp}.png). Saved to the system temp directory.
- `[[TOOL:screen_capture_window|app_name|filename]]` — Capture a screenshot of a specific application window (macOS only). The app_name is required, filename is optional.
- `[[TOOL:screen_list_windows]]` — List all currently visible windows with their application names and titles.

## Platform Support

- **macOS**: Uses the built-in `screencapture` command. Window-specific capture uses AppleScript + screencapture.
- **Windows**: Uses PowerShell with `System.Windows.Forms` and `System.Drawing` to capture the primary screen.
- **Linux**: Falls back to ImageMagick's `import` command if available.

## Usage Tips

- Use `screen_list_windows` first to identify which applications and windows are open.
- Capture screenshots to verify UI states, document bugs, or monitor dashboards.
- On macOS, Screen Recording permission may be required in System Settings > Privacy & Security.
- Screenshots are saved as PNG files in the system temp directory.
