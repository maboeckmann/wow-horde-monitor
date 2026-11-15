# EU PvP Horde phone monitor

Independent RSS checker executed by GitHub Actions and triggered every five minutes by cron-job.org. No ChatGPT, OpenAI API key, or running PC is required.

## What it can establish

This is a conservative text-matching detector, not ChatGPT research and not a Blizzard status API. It checks five feeds: EU Forever general discussion, the faction-balance announcement thread, Kaivax and Aggrend activity, and r/wowforever new posts. Two distinct authors must explicitly report FIRST Horde creation on regular EU PvP within the last hour; these alerts say **UNCONFIRMED**. A matching recent reopening statement by Kaivax or Aggrend on the EU forum produces a separate source-linked alert to read and verify. All alerts require manual verification. Ambiguous or differently worded reports may be missed. Source feeds can be incomplete or block GitHub runners.

The subreddit-wide Reddit comments RSS feed returned HTTP 429 during the initial cloud test and is excluded. Reddit comment-only reports are not covered. Each run logs the status and item count of every configured feed, and alerts if any configured feed fails.

## Deploy

1. Create a dedicated GitHub repository and put the contents of this directory at its root, including `.github/workflows/monitor.yml`. Do not upload the parent workspace or the ntfy topic.
2. In repository **Settings > Secrets and variables > Actions**, add repository secret `NTFY_TOPIC` containing the topic subscribed to on your phone. Optionally add `NTFY_TOKEN` for an authenticated ntfy account.
3. In **Actions**, enable workflows if prompted. Choose **EU PvP Horde monitor > Run workflow**, check `test_push`, and run it on the default branch. Confirm the phone receives **TEST ONLY - GitHub WoW monitor**.
4. Run again with `test_push` unchecked. Inspect source failures and output. The workflow reserves a `monitor-state` branch automatically; keep it dedicated to this checker.
5. Configure the external five-minute job using [cron-job-setup.md](cron-job-setup.md). This workflow uses only `workflow_dispatch`; GitHub's unreliable scheduled trigger is removed. External scheduling and GitHub runner availability still have no exact-time guarantee. Public standard runners are free; private repositories use the account's included quota.
6. Enable cron-job.org failure, recovery, and automatic-disable notifications, and attach email and ntfy channels. These report dispatch failures; an accepted dispatch does not prove the checker finished. Enable GitHub Actions failure notifications as another fallback. An independent missed-success heartbeat is not configured by this repository.

The state branch records a last-check timestamp before any feed requests. The external clock ticks every five minutes; a four-minute minimum gap allows one minute of runner-start jitter while rejecting queued duplicate bursts. There is no missed-interval replay. Evidence IDs prevent repeating the same reopening alert. Source failures produce a phone alert; persistent identical source failures are summarized at most hourly and recovery produces a separate message. A workflow-level failure alert covers failed jobs. A runner or ntfy outage can still prevent delivery.

## Test locally

Requires Node.js 24 or newer. `node --test monitor.test.mjs` tests the detector without networking or sending pushes. Running `node monitor.mjs` requires `NTFY_TOPIC` in the environment and writes `.monitor-state.json`. `node monitor.mjs --test-push` sends a clearly labelled test.

Your local ChatGPT monitor remains separate and unchanged. View cloud runs and source status in the repository's Actions tab. The private ntfy topic belongs only in repository secrets, never in committed files.
