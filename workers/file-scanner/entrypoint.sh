#!/bin/sh
set -eu

freshclam --no-warnings
exec node src/server.js
