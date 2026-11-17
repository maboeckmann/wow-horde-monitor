# EU PvP Horde phone monitor

Independent RSS checker executed by GitHub Actions and triggered every five minutes by cron-job.org. No ChatGPT, OpenAI API key, or running PC is required.

## What it can establish

This is a conservative text-matching detector, not ChatGPT research and not a Blizzard status API. It checks four Blizzard EU forum feeds: Forever general discussion, the faction-balance announcement thread, and Kaivax and Aggrend activity. Reddit posts and comments are no longer monitored. Two distinct authors must explicitly report FIRST Horde creation on regular EU PvP within the last hour; these alerts say **UNCONFIRMED**. A matching recent reopening statement by Kaivax or Aggrend on the EU forum produces a separate source-linked alert to read and verify. All alerts require manual verification. Ambiguous or differently worded reports may be missed. Source feeds can be incomplete or block GitHub runners.

Reddit ended RSS support on November 13, 2026 ([official announcement](https://support.reddithelp.com/hc/en-us/articles/55472297340308-Changelog-November-10-2026)). Direct HTML/JSON diagnostics also encountered verification challenges and access restrictions. No reliable supported replacement was verified, so Reddit was removed rather than silently treated as healthy. Forum-only coverage may miss brief openings reported only on Reddit. Each run logs the status and item count of every configured feed. A failed run means at least one configured feed failed, or the workflow could not complete.

## Notification policy

- New reopening evidence alerts immediately on detection, even when some feeds fail. The existing evidence criteria and evidence deduplication still apply. At most one reopening message is sent per run, with a Blizzard statement taking priority over community reports.
- Technical failures alert after **12 consecutive failed runs** (nominally one hour), or when **more than 50% of recorded runs in the rolling six-hour window fail**. The ratio rule starts after six hours of observation; it does not extrapolate from a small startup sample.
- One failure alert opens an incident. Changed errors and continued failures produce no repeat failure alerts. Only an alerted incident can produce a back-to-normal message, and only after a fully successful check with the six-hour failure rate at most 50%. A new incident can alert after that recovery.
- A reopening notification takes priority over technical notifications in the same run. If an incident is active, the reopening notification replaces its recovery message; the incident clears silently once monitoring recovers.
- History and incident status persist on `monitor-state`. Skipped checks do not enter the history; interrupted reserved checks remain failed. Workflow fallback reporting uses the same policy and run ID, so it cannot count a source failure twice or bypass suppression after an opening.
- Failure alerts are reserved in saved state before attempting delivery to avoid repeat attempts after ambiguous ntfy/storage failures. A failed failure-notification attempt stays suppressed for that incident and cannot produce a false recovery message. A failed recovery delivery keeps the incident active. Delivery cannot be guaranteed during a notification outage.

The six-hour history begins with the first run of this version; it does not invent past outcomes. Old evidence IDs and the interval guard are preserved. If the old version already sent an outstanding failure alert, it remains an active incident during migration.

## Deploy

1. Create a dedicated GitHub repository and put the contents of this directory at its root, including `.github/workflows/monitor.yml`. Do not upload the parent workspace or the ntfy topic.
2. In repository **Settings > Secrets and variables > Actions**, add repository secret `NTFY_TOPIC` containing the topic subscribed to on your phone. Optionally add `NTFY_TOKEN` for an authenticated ntfy account.
3. In **Actions**, enable workflows if prompted. Leave `test_push` unchecked. Do not send test notifications to the shared topic.
4. Inspect ordinary scheduled runs, source results, and saved state. The workflow reserves a `monitor-state` branch automatically; keep it dedicated to this checker.
5. Configure the external five-minute job using [cron-job-setup.md](cron-job-setup.md). This workflow uses only `workflow_dispatch`; GitHub's unreliable scheduled trigger is removed. External scheduling and GitHub runner availability still have no exact-time guarantee. Public standard runners are free; private repositories use the account's included quota.
6. Keep cron-job.org dispatch failure, recovery, and automatic-disable alerts on **email only**, with failure notification after 12 consecutive failures. Do not attach the shared ntfy channel: native scheduler notifications bypass the script's incident state. These emails report dispatch failures; an accepted dispatch does not prove the checker finished. GitHub Actions failure emails are another independent fallback. An independent missed-success heartbeat is not configured by this repository.

The state branch records a last-check timestamp before any feed requests. The external clock ticks every five minutes; a four-minute minimum gap allows one minute of runner-start jitter while rejecting queued duplicate bursts. There is no missed-interval replay. Evidence IDs prevent repeating the same reopening alert. Workflow setup/runtime failures use the shared history instead of an immediate push. If no runner can execute, or GitHub state cannot be read/written, the script cannot reliably record an outcome or deliver a stateful alert. A runner or ntfy outage can still prevent delivery; inspect the independent emails in those cases.

## Test locally

Requires Node.js 24 or newer. `node --test monitor.test.mjs` tests the detector and incident policy with networking disabled. Running `node monitor.mjs` requires `NTFY_TOPIC` in the environment and writes `.monitor-state.json`. The legacy `--test-push` command still sends a notification: do not run it against the shared topic.

Your local ChatGPT monitor remains separate and unchanged. View cloud runs and source status in the repository's Actions tab. The private ntfy topic belongs only in repository secrets, never in committed files.

## November 17 coverage migration

The first upgraded run records blizzard-forums-v1 in persistent state. Existing failure history, check reservations and alerted evidence IDs are preserved. An existing incident is marked to close silently on recovery, avoiding a misleading recovery push merely because Reddit was removed. Future genuine Blizzard feed failures retain the same alert thresholds. Every run logs the reduced coverage. No test notifications are needed for verification.

