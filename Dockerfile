FROM node:24-bookworm

# Install build dependencies for native modules (like node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pi-coding-agent globally so it can be used by the app
RUN npm install -g @mariozechner/pi-coding-agent

# Set the path to pi explicitly so the application finds it
ENV PI_PATH="/usr/local/bin/pi"

WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# Install project dependencies
RUN npm install

# Bundle app source
COPY . .

# Ensure output and uploads directories exist
RUN mkdir -p uploads output

# Run the app
CMD [ "npm", "start" ]
