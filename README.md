# Flow Forge Labs - Waitlist API

Simple API for handling waitlist signups, storing to Snowflake.

## Setup

1. Copy `.env.example` to `.env` and fill in your Snowflake credentials
2. Install dependencies: `npm install`
3. Run: `npm start`

## Deployment to Hetzner VPS

### 1. Upload the API

```bash
scp -r flowforge-api fernando@5.161.90.16:~/
```

### 2. SSH into server and setup

```bash
ssh fernando@5.161.90.16

# Install Node.js if not already installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Setup the API
cd ~/flowforge-api
npm install --production

# Create .env file
cp .env.example .env
nano .env  # Fill in your Snowflake credentials
```

### 3. Setup systemd service

```bash
sudo nano /etc/systemd/system/flowforge-api.service
```

Add:
```ini
[Unit]
Description=Flow Forge Waitlist API
After=network.target

[Service]
Type=simple
User=fernando
WorkingDirectory=/home/fernando/flowforge-api
ExecStart=/usr/bin/node index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable flowforge-api
sudo systemctl start flowforge-api
sudo systemctl status flowforge-api
```

### 4. Update Caddy to proxy API requests

```bash
sudo nano /etc/caddy/Caddyfile
```

Add:
```
api.flowforgelabs.io {
    reverse_proxy localhost:3001
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

### 5. DNS

Add an A record for `api.flowforgelabs.io` pointing to `5.161.90.16`

## Endpoints

- `GET /health` - Health check
- `POST /api/waitlist` - Submit email to waitlist
  - Body: `{ "email": "user@example.com" }`
