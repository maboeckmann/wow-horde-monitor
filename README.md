# EU PvP Horde phone monitor

Independent GitHub Actions RSS checker. No ChatGPT, OpenAI API key, or running PC is required.

## What it can establish

This is a conservative text-matching detector, not ChatGPT research and not a Blizzard status API. It checks EU Forever forum feeds, known staff-account activity feeds, and r/wowforever posts/comments. Two distinct authors must explicitly report FIRST Horde creation on regular EU PvP within the last hour; these alerts say **UNCONFIRMED**. A matching recent reopening statement by Kaivax or Aggrend on the EU forum produces a separate source-linked alert to read and verify. All alerts require manual verification. Ambiguous or differently worded reports may be missed. Source feeds can be incomplete or block GitHub runners. Inspect the first cloud runs before relying on it.

## Deploy

1. Create a dedicated GitHub repository and put the contents of this directory at its root, including `.github/workflows/monitor.yml`. Do not upload the parent workspace or the ntfy topic.
2. In repository **Settings > Secrets and variables > Actions**, add repository secret `NTFY_TOPIC` containing the topic subscribed to on your phone. Optionally add `NTFY_TOKEN` for an authenticated ntfy account.
3. In **Actions**, enable workflows if prompted. Choose **EU PvP Horde monitor > Run workflow**, check `test_push`, and run it on the default branch. Confirm the phone receives **TEST ONLY - GitHub WoW monitor**.
4. Run again with `test_push` unchecked. Inspect source failures and output. The workflow reserves a `monitor-state` branch automatically; keep it dedicated to this checker.
5. Scheduled checks run about every five minutes, offset from the hour. GitHub can delay/drop schedules; these are not real-time guarantees. Public standard runners are free; private repositories use the account's included quota. A public scheduled workflow can be disabled after 60 days of inactivity. No paid plan is required, but monitor quota if the repository is private.
6. Enable GitHub Actions failure notifications as an independent fallback. ntfy cannot report a failure of ntfy itself, exhausted Actions quota, or a scheduler that never starts.

The state branch records a last-check timestamp before any feed requests, so queued invocations within five minutes skip searches. There is no missed-interval replay. Evidence IDs prevent repeating the same reopening alert. Source failures produce a phone alert; persistent identical source failures are summarized at most hourly and recovery produces a separate message. A workflow-level failure alert covers failed jobs. A runner or ntfy outage can still prevent delivery.

## Test locally

Requires Node.js 24 or newer. `node --test monitor.test.mjs` tests the detector without networking or sending pushes. Running `node monitor.mjs` requires `NTFY_TOPIC` in the environment and writes `.monitor-state.json`. `node monitor.mjs --test-push` sends a clearly labelled test.

Your local ChatGPT monitor remains separate and unchanged. This cloud version is not active until deployed, configured, and verified on GitHub.
