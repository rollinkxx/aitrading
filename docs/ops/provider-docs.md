# Provider documentation used for this release

Reviewed on 2026-11-09. These are the upstream references used to check current Worker configuration and release assumptions:

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) — compatibility dates, observability, and static-asset recommendations.
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) — enable invocation/log collection in Wrangler and redeploy for the setting to take effect.
- [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) — Worker `observability`, `assets`, compatibility, and preview configuration fields.
- [Workers Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/) — asset directory and SPA fallback behavior.
- [Workers Previews configuration](https://developers.cloudflare.com/workers/previews/configuration/#wrangler-configuration-file) — a preview trigger must use the project Wrangler config containing the `previews` block.

AITrading's Worker remains a static-asset front end. Production deployment is separate from the CI Wrangler dry-run; no Cloudflare Cron Trigger is added because background schedules are owned by Supabase `pg_cron`.

## Workers Build preview trigger

On 2026-11-09, the Cloudflare build for commit `17addf8` completed `npm run build` but failed during `npx wrangler preview` because the command ran from the repository root without loading the Wrangler file in `cloudflare/`; Wrangler therefore reported a missing `previews` block. The preview trigger for `fix/production-readiness` was updated to run `npx wrangler preview --config cloudflare/wrangler.jsonc`. Keep this explicit config path whenever that trigger or a replacement is edited. The account had no main-branch Workers Build trigger during this audit, so production remains an explicit release step using `npx wrangler deploy --config cloudflare/wrangler.jsonc` after release gates pass.
