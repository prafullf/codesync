#!/bin/sh
# Source code arrives on stdin and is written to the tmpfs; it is never
# interpolated into a shell command.
# Drop everything up to the marker line (see STDIN_MARKER in the worker's runner.ts).
sed '1,/^__CODESYNC_SOURCE_BEGIN__$/d' > /tmp/main.py || exit 1
exec python3 /tmp/main.py </dev/null
