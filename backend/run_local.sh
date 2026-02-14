#!/bin/bash

echo "Setup Local Backend for WebRTC..."

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "Python3 could not be found. Please install it."
    exit 1
fi

# Create venv if not exists
if [ ! -d "venv" ]; then
    echo "Creating venv..."
    python3 -m venv venv
fi

# Activate
source venv/bin/activate

# Install Deps
echo "Installing dependencies..."
# We use the same requirements file
pip install -r requirements.txt

# Run
echo "Starting Backend on Port 5001..."
# Ensure we use 5001 to match the mobile app config
export FLASK_APP=main.py
python main.py
