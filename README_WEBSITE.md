# CA Final Study Command Center — Website / PWA

This is the website version. It is designed primarily for Android Chrome but also works on desktop browsers.

## Core dates

- Official study start: 24 September 2026
- Lecture target: 15 December 2026
- Syllabus target: 31 December 2026
- The website has **no expiry date**.
- Enter your actual CA Final exam date in Settings when known; planning then extends through that date.

## Why this is easier than the Android APK

You host these static files once. After that:

- open the website in Chrome;
- tap **Install** / **Add to Home screen**;
- it behaves like an app;
- there is no APK to rebuild for ordinary content/data changes;
- the service worker caches the core website for offline opening.

## Data safety

The site uses browser **IndexedDB**, not temporary page memory.

It stores:
- subjects;
- lecture totals/progress;
- study tasks;
- backlog;
- revision/test tasks;
- study blocks;
- Google Calendar event IDs;
- exam date and planner settings.

It also keeps up to **30 rolling local snapshots**.

However, browsers can clear local site data. Therefore use at least one external backup:

### JSON backup
Settings → Backup & Restore → **Export JSON**.

Save the JSON in Google Drive/Downloads. Restore with **Restore JSON**.

### Private Google Drive app-data backup
If Google integration is configured, the site can back up the full database to Google Drive's private `appDataFolder` using the narrow `drive.appdata` scope.

Google documents `appDataFolder` specifically for application-specific data and the `drive.appdata` scope for viewing/managing that app's own configuration data.

## Google Calendar safety

The website requests:
- `calendar.readonly` — read existing commitments.
- `calendar.app.created` — create/manage the dedicated app-created `CA Final Study Plan` calendar.
- `drive.appdata` — optional private cloud backup.

It does not intentionally edit events on your unrelated personal calendars.

Each study event stores a private `ca_task_key` and the returned Google event ID. Future sync updates the matching event instead of blindly creating duplicates.

## Easiest phone-only website hosting: GitHub Pages

1. Download this ZIP to your phone and extract it.
2. Create a GitHub repository.
3. Upload the extracted files to the repository.
4. Open repository **Settings → Pages**.
5. Under Build and deployment, select **GitHub Actions**.
6. Open **Actions** and run `Deploy website to GitHub Pages` if it does not run automatically.
7. GitHub will provide an HTTPS website URL.
8. Open the URL in Chrome on Android.
9. Chrome menu → **Add to Home screen** / **Install app**.

Keep a bookmark of the exact URL.

## Google OAuth setup for the website

Calendar/Drive integration needs your own Google Cloud web OAuth client.

1. Create a Google Cloud project.
2. Enable:
   - Google Calendar API
   - Google Drive API
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID of type **Web application**.
5. Add your exact deployed HTTPS origin under **Authorized JavaScript origins**.
   Example:
   `https://YOUR_USERNAME.github.io`
6. Add the scopes used by the website to the consent configuration.
7. Copy the Web Client ID.
8. Website → Settings → Google Web Client ID → paste it → Save.
9. Calendar → Connect Google.

The Client ID is public configuration, not a password or client secret.

## First use

1. Open Subjects.
2. Enter FR total lectures.
3. Enter AFM total lectures.
4. Confirm/edit Audit total (80 default).
5. Set average lecture durations realistically.
6. Open Settings and adjust study blocks/hours.
7. Build / Refresh Plan.
8. Configure Google integration if desired.
9. Export the first JSON backup.

## Important backup routine

For exam preparation, use:
- automatic IndexedDB persistence,
- rolling local snapshots,
- Google Drive app-data backup when connected,
- and a separate exported JSON file.

A separate exported backup is the strongest protection against browser-site-data deletion, phone reset, lost device, or accidental clearing of Chrome storage.
