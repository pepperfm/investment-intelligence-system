# Ubuntu deployment / Bun

No Docker on production. Provision Bun, PostgreSQL/MySQL, Redis, Nginx and a dedicated unprivileged user.

1. Install Bun at /usr/local/bin/bun (root-owned executable). Create /var/www/iis/releases and a user/group named iis. Adjust paths/user names in the unit files as required.
2. Put environment variables from .env.example into /etc/iis/app.env, owned by root:iis, mode 0640. Use strong database credentials and a unique auth secret. Set NUXT_PUBLIC_SITE_URL to the exact HTTPS origin. Keep the app port and database/Redis ports private.
3. Build in a new release directory: bun install --frozen-lockfile, bun run typecheck, bun run build. Commit bun.lock after the first installation. Do NOT pass secrets to the build. The Nitro preset is bun.
4. With the production environment exported, apply the committed migrations using bun run db:migrate. Do not generate migrations on the server. Use backward-compatible expand/contract migrations; rolling back code does not undo schema changes.
5. With the production environment exported, run bun run schedule:register. Keep workers/ and production dependencies in each release. Nitro output alone does not contain standalone worker sources.
6. Atomically switch current to the new release; restart the app and worker systemd unit. Check /api/health, then keep the old release for rollback. This minimal single-instance example has a short restart interruption; it is not a zero-downtime deployment orchestrator.
7. Add HTTPS to Nginx before public auth. Review trusted proxies, CSP and rate limits. Back up the SQL database and durable Redis; enable AOF and noeviction on durable Redis. Monitor memory: noeviction rejects writes when full.

Copy deploy/app.service to /etc/systemd/system/iis.service and deploy/worker.service to /etc/systemd/system/iis-worker.service, then run systemctl daemon-reload. These files are examples; the generator never provisions or deploys a server.

/api/health is a process liveness check, not a guarantee that DB/Redis are healthy. Add protected readiness checks and alerts for your product.
