---
title: "CLI overview"
description: "The dopgate command line: run the server, create the root account, and manage an instance."
---

# CLI overview

The `dopgate` binary is both the server and its admin tool.

```bash
dopgate serve             # run the server
dopgate init              # create the root account on a new instance
dopgate backup create     # planned
dopgate users export FILE # planned
dopgate keys rotate       # planned
```

Every command accepts `--json`, which prints results and errors as one line of JSON for scripts. Commands that work on an instance accept `--data-dir`, `--config`, and `--master-key`; without them, dopgate uses `~/.dopgate`.

Planned commands exist so scripts and docs can refer to them. They exit with code `2` and say they are not built yet.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error |
| `2` | The command is planned and not built yet |
| `130` | You cancelled a prompt |

See the [command reference](/cli/commands) for every flag.
