#!/bin/sh
set -eu

ollama serve &
server_pid=$!

sleep 5
ollama pull "${OLLAMA_MODEL:-gemma4:latest}"

wait "$server_pid"
