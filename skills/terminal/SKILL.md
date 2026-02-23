---
name: terminal
description: Execute shell commands, read/write files, and manage the local filesystem.
metadata:
  {
    "openclaw":
      {
        "emoji": "💻",
        "os": ["darwin", "win32", "linux"],
      },
  }
---

# Terminal Execution

Execute shell commands and manage files directly on the local machine.

## Available Tools

- `[[TOOL:shell_exec|command]]` — Execute a shell command and return stdout + stderr. Commands run in bash/zsh on macOS/Linux or PowerShell on Windows. 30-second timeout, max 8000 chars output.
- `[[TOOL:shell_exec_bg|command]]` — Execute a command in the background (non-blocking). Returns the process ID immediately.
- `[[TOOL:shell_read_file|filepath]]` — Read the contents of a local file (max 512 KB).
- `[[TOOL:shell_write_file|filepath|content]]` — Write content to a local file. Creates parent directories if needed.
- `[[TOOL:shell_list_dir|dirpath]]` — List files and directories at the given path (max 100 entries).

## Platform Support

- **macOS/Linux**: Commands run in `/bin/bash` by default.
- **Windows**: Commands run in `powershell.exe` with `-NoProfile`.

## Security

- Destructive commands like `rm -rf /`, `format`, `mkfs`, and `dd` are blocked automatically.
- Always explain what commands you plan to run before executing them.
- For destructive operations, ask for explicit user confirmation first.

## Common Use Cases

- Running build commands (`npm install`, `cargo build`, `make`)
- Git operations (`git status`, `git log`, `git diff`)
- System diagnostics (`top`, `df -h`, `ps aux`)
- File management (reading configs, writing scripts, listing project files)
- Running test suites and checking results
- Package management (`brew`, `apt`, `pip`, `npm`)
