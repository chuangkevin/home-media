#!/bin/bash

echo "============================================="
echo "Stopping LOCAL DEVELOPMENT servers for macOS..."
echo "============================================="
echo ""

# Function to kill process on a given port
kill_port_process() {
  PORT=$1
  echo "Attempting to stop process on port $PORT..."
  # Find PID using lsof, then kill it
  # -t for process IDs only
  # -i :$PORT for network files on specified port
  PID=$(lsof -t -i :$PORT)
  if [ -z "$PID" ]; then
    echo "No process found running on port $PORT."
  else
    echo "Killing process $PID on port $PORT."
    kill -9 $PID
    echo "Process on port $PORT stopped."
  fi
}

# Stop Backend (Port 3001)
kill_port_process 3001

# Stop Frontend (Port 5173)
kill_port_process 5173

echo ""
echo "============================================="
echo "All local development servers stopped."
echo "============================================="
echo ""
