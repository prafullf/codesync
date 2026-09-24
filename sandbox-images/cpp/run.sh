#!/bin/sh
# Compile then run; compilation counts toward the 5 s wall-clock limit.
# Drop everything up to the marker line (see STDIN_MARKER in the worker's runner.ts).
sed '1,/^__CODESYNC_SOURCE_BEGIN__$/d' > /tmp/main.cpp || exit 1
g++ -std=c++17 -O0 -pipe -o /tmp/main /tmp/main.cpp || exit 1
exec /tmp/main </dev/null
