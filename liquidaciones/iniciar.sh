#!/bin/bash
cd "$(dirname "$0")"
node server.js &
sleep 2
open http://localhost:5173/index.html
