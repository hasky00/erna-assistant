# Erna — Hetzner deployment

Deploy Erna at **https://erna.aiassistent.site** on your Hetzner server. The main site (`aiassistent.site`) can stay on Netlify; only the subdomain points to Hetzner.

## Files in this folder

| File | Purpose |
|------|---------|
| `nginx-erna.conf` | Nginx reverse proxy to Next.js on port 3000 |
| `ecosystem.config.js` | PM2 process manager config |
| `deploy.sh` | Pull, install, build, restart |
| `.env.production.example` | Production env template (copy to repo root `.env`) |

## Prerequisites (Ubuntu 22.04/24.04)

- Hetzner server with public IPv4
- DNS **A** record: `erna` → your server IP (managed in Netlify DNS)
- SSH access as a non-root user (example: `erna`)

## 1. Server bootstrap (first time only)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx ufw

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm install -g pm2

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Create app user (optional but recommended):

```bash
sudo adduser erna
sudo usermod -aG sudo erna
```

## 2. Clone and configure the app

As the deploy user:

```bash
cd ~
git clone <your-repo-url> erna
cd erna

cp deploy/.env.production.example .env
nano .env   # fill in Supabase + OpenAI keys
```

## 3. First deploy

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

Register PM2 on boot:

```bash
pm2 startup
# run the command PM2 prints, then:
pm2 save
```

## 4. Nginx

```bash
sudo cp deploy/nginx-erna.conf /etc/nginx/sites-available/erna
sudo ln -sf /etc/nginx/sites-available/erna /etc/nginx/sites-enabled/erna
sudo nginx -t
sudo systemctl reload nginx
```

## 5. SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d erna.aiassistent.site
```

Certbot updates the Nginx config for HTTPS and sets up auto-renewal.

## 6. Supabase auth URLs

In Supabase → **Authentication** → **URL Configuration**:

- **Site URL:** `https://erna.aiassistent.site`
- **Redirect URLs:** `https://erna.aiassistent.site/**`

## 7. Verify

```bash
dig erna.aiassistent.site +short    # should show Hetzner IP
pm2 status
pm2 logs erna --lines 50
curl -I https://erna.aiassistent.site
```

Browser checks:

- Sign up / sign in
- New chat + send message
- Load previous conversations (sidebar + Load more)
- `/admin` personality editor

## Updates

From the repo root on the server:

```bash
./deploy/deploy.sh
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| 502 Bad Gateway | `pm2 status`, `pm2 logs erna` — app not running on :3000 |
| Login redirect loop | Supabase Site URL + redirect URLs; `proxy.ts` present in repo |
| SSL errors | `sudo certbot renew --dry-run` |
| Build OOM | Add swap or build locally and rsync `.next` (not recommended long-term) |

## Custom app path

If the repo is not at `/home/erna/erna`:

```bash
export ERNA_APP_DIR=/path/to/erna
./deploy/deploy.sh
```

Or edit `cwd` in `ecosystem.config.js`.