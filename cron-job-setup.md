# External scheduler setup

This replaces GitHub's delayed schedule trigger with cron-job.org. GitHub still executes the checker and sends ntfy alerts. A successful HTTP dispatch confirms GitHub accepted the request; it does not prove the checker finished.

## Account and token

Sign in at https://console.cron-job.org/. A free account supports the five-minute interval. Its management API quota is separate from scheduled executions; this job calls GitHub, not the cron-job.org management API.

Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new:

- Name: `cron-job WoW monitor`.
- Resource owner: `maboeckmann`.
- Repository access: only `wow-horde-monitor`.
- Repository permission: **Actions: Read and write**. Metadata read access is automatic.
- Choose an expiration date and record it. An expired token stops dispatches and should cause a cron-job.org failure email.
- Enter the token directly into the cron-job.org job's Authorization header. Do not paste it into chat, this document, the JSON template, or a Git commit.

## Job configuration

The companion `cron-job.template.json` contains the non-secret API settings. It is a reference template, not an active job. It is deliberately disabled until the credential has been entered and the dispatch tested.

- Title: `WoW EU PvP Horde - five-minute cloud check`.
- URL: `https://api.github.com/repos/maboeckmann/wow-horde-monitor/actions/workflows/monitor.yml/dispatches`.
- Method: **POST**.
- Schedule: every five minutes, at minutes 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, every hour and day; Europe/Berlin. This matches the console's **Every 5 minutes** preset.
- Headers: `Accept: application/vnd.github+json`, `Content-Type: application/json`, `X-GitHub-Api-Version: 2026-03-10`, and `Authorization: Bearer YOUR_TOKEN`.
- Body: `{"ref":"main","inputs":{"test_push":false}}`.
- Enable failure, recovery, and automatic-disable email notifications, with failure notification after 12 consecutive failures. Select the account email channel only. Keep the shared ntfy channel detached so native scheduler alerts cannot bypass the script's incident policy. A recovery email means dispatch works again, not necessarily that source coverage recovered.
- Timeout: 30 seconds. Save responses so the returned run ID can be inspected.

## Verification and cutover

1. Keep `test_push` set to `false`; do not send test alerts to the shared topic.
2. Enable the five-minute job and inspect ordinary scheduled runs.
3. Inspect at least three consecutive automatic cron-job.org executions, their corresponding GitHub workflow runs, and full-check source results. A gate SKIP is not a full source check.
4. Preserve the persistent interval guard. Do not reset its state to force checks or replay missed intervals.
5. Once external triggering is verified, remove only the GitHub workflow's `schedule` trigger; keep `workflow_dispatch`. Do not disable the whole workflow.
6. An independent missed-success heartbeat remains a separate setup step: a scheduler can accept requests while the worker never finishes. Do not claim that dispatch failure emails cover this case.

The separate local ChatGPT automation is unchanged by this setup.
