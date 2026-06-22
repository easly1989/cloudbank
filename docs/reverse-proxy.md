# Running CloudBank behind a reverse proxy (HTTPS)

CloudBank serves plain HTTP on port `8080`. For anything beyond a trusted LAN you
should terminate TLS in front of it with a reverse proxy. CloudBank's session
cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` **by default** — so when a
proxy terminates HTTPS, keep the default (`CB_SECURE_COOKIES=true`). Only set
`CB_SECURE_COOKIES=false` for a plain-HTTP install with no TLS at all.

The app needs nothing special from the proxy: forward all paths to `8080`, pass
the usual headers, and allow the response body to stream (file downloads and the
hot backup can be large).

## Caddy

Caddy gets you automatic Let's Encrypt certificates with no extra config:

```caddyfile
finance.example.com {
    reverse_proxy cloudbank:8080
}
```

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name finance.example.com;

    ssl_certificate     /etc/letsencrypt/live/finance.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/finance.example.com/privkey.pem;

    # Backups and the database snapshot can be large; don't cap the body.
    client_max_body_size 0;

    location / {
        proxy_pass http://cloudbank:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Traefik (compose labels)

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.cloudbank.rule=Host(`finance.example.com`)"
      - "traefik.http.routers.cloudbank.entrypoints=websecure"
      - "traefik.http.routers.cloudbank.tls.certresolver=le"
      - "traefik.http.services.cloudbank.loadbalancer.server.port=8080"
    volumes:
      - cloudbank-data:/data
    # Keep CB_SECURE_COOKIES at its default (true) — Traefik terminates TLS.

volumes:
  cloudbank-data:
```

## Health checks

The proxy (or your orchestrator) can probe `GET /healthz`, which returns
`{"status":"ok"}` and `200` when the database is reachable. This endpoint is
unauthenticated.

## Notes

- CloudBank does not need a sub-path; host it at the domain root.
- WebSocket upgrades are not required.
- If you put it on a sub-domain, that's all CloudBank needs — it has no
  hard-coded base URL.
