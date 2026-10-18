# Running your own Noted server

Noted syncs your devices through a small server that you run yourself. One server holds one
vault (one person's notes). Notes, files and their titles are encrypted on your devices before
they are uploaded: the server only stores sealed data and never sees your passphrase or key.

You need a machine that stays on (a home server, a Raspberry Pi 4/5, a small VPS) with Docker
and Docker Compose. The image runs on `amd64` and `arm64`.

## 1. Start the server

```sh
mkdir noted-server && cd noted-server
curl -o docker-compose.yml https://raw.githubusercontent.com/Juliuszjk/noted/main/infra/docker/compose.example.yml
# edit docker-compose.yml: ports, TZ, NOTED_PUBLIC_URL (see below)
docker compose up -d
docker logs noted_api
```

The log shows a line like:

```
vault: no vault yet. Setup code for the first device: ABCD-EFGH-JKMN
```

Keep that code for step 3. It makes sure that nobody else can create the vault on your server
before you do. It stops working once your vault exists.

## 2. Make it reachable from your devices

The server has two ports:

| Port in the container | What                                  | Who needs it               |
|-----------------------|---------------------------------------|----------------------------|
| 3000                  | private API (sync)                    | only your own devices      |
| 3001                  | published notes (read-only links)     | anyone you send a link to  |

Pick one way to reach the private API:

**A. Tailscale (simplest, nothing exposed to the internet).** Install
[Tailscale](https://tailscale.com) on the server and on every device. In `docker-compose.yml`
bind the API to the server's Tailscale address, e.g. `"100.101.102.103:3333:3000"`. In the
apps the server address is then `100.101.102.103:3333`.

**B. A domain with HTTPS.** Point a domain at the server and put a reverse proxy in front of
the container. With [Caddy](https://caddyserver.com) (HTTPS certificates are automatic):

```
notes.example.com {
	reverse_proxy 127.0.0.1:3333
}
share.example.com {
	reverse_proxy 127.0.0.1:3334
}
```

In the apps the server address is then `https://notes.example.com`. Use a long passphrase:
anyone can download the vault's salt and verifier and try passphrases offline (Argon2id makes
each guess slow, but a short passphrase is still guessable).

Never expose the private API over plain `http://` on a public address.

### Published notes

To share notes by link, the public port (3001) must be reachable over HTTPS, e.g.
`share.example.com` above, or `tailscale funnel --bg --https=8443 http://127.0.0.1:3334`.
Set that address as `NOTED_PUBLIC_URL` and restart (`docker compose up -d`). The apps read it
from the server. Without it everything else works, only publishing is off.

## 3. Connect the apps

Install Noted on your first device, enter the server address, choose a passphrase and enter
the setup code from step 1. Then save the recovery key (Settings > Account): without it a forgotten
passphrase cannot be recovered, by you or by anyone else.

Other devices: enter the same server address and your passphrase.

## Updating

```sh
docker compose pull && docker compose up -d
```

## Backups

The server keeps a copy of its database every night (the newest 7) inside the volume. That
copy is on the same disk, so it is not a real backup: also make encrypted backups from the app
(Settings > Backup & export, also automatic into a folder) and keep them somewhere else.

The database lives in the Docker volume `noted_data` (`docker volume ls` shows it with the folder name in front). To move the server, copy the volume, or
start a fresh server and use "New or replaced server? Set it up from a backup" in the app.
