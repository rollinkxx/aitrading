# Provider documentation used for this release

Reviewed on 2026-11-09. These are the upstream references used to check current Worker configuration and release assumptions:

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) — compatibility dates, observability, and static-asset recommendations.
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) — enable invocation/log collection in Wrangler and redeploy for the setting to take effect.
- [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) — Worker `observability`, `assets`, compatibility, and preview configuration fields.
- [Workers Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/) — asset directory and SPA fallback behavior.

AITrading's Worker remains a static-asset front end. Production deployment is separate from the CI Wrangler dry-run; no Cloudflare Cron Trigger is added because background schedules are owned by Supabase `pg_cron`.
