#!/bin/sh
# Drop everything up to the marker line (see STDIN_MARKER in the worker's runner.ts).
sed '1,/^__CODESYNC_SOURCE_BEGIN__$/d' > /tmp/main.js || exit 1
exec node --max-old-space-size=96 /tmp/main.js </dev/null
