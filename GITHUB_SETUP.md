# GitHub Integration — CA Final Study Command Center

This repository is ready for GitHub Pages.

## Repository setup

Create a PRIVATE GitHub repository, for example:

`ca-final-study-command-center`

Upload every file and folder in this project to the repository root.

The important deployment workflow is already included at:

`.github/workflows/pages.yml`

## Enable GitHub Pages

1. Open the repository.
2. Go to **Settings**.
3. Open **Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. Open the **Actions** tab.
6. Run **Deploy website to GitHub Pages** if it has not run automatically.
7. Open the successful deployment.
8. Use the GitHub Pages URL shown there.

Typical project-site URL:

`https://YOUR_GITHUB_USERNAME.github.io/ca-final-study-command-center/`

## Android use

Open the deployed URL in Chrome.

Then:

**Chrome menu → Add to Home screen / Install app**

The site is a PWA and can launch from the Android Home Screen.

## Google OAuth after deployment

For Google Calendar + Drive backup:

1. Enable Google Calendar API and Google Drive API in Google Cloud.
2. Create OAuth 2.0 credentials of type **Web application**.
3. Add the website origin under **Authorized JavaScript origins**.

For GitHub Pages, the origin is usually:

`https://YOUR_GITHUB_USERNAME.github.io`

4. Copy the Google Web Client ID.
5. Open the deployed website.
6. Go to **Settings → Google Web Client ID**.
7. Paste it and save.
8. Open **Calendar → Connect Google**.

The website uses:
- `calendar.readonly`
- `calendar.app.created`
- `drive.appdata`

## Data protection

GitHub hosts the website code, not your personal study database.

Your actual study data is stored in:
- browser IndexedDB,
- rolling local snapshots,
- exported JSON backups,
- optional Google Drive private app-data backup.

Export a JSON backup regularly.

## Updating the website

Whenever repository files are updated and pushed to `main` or `master`,
GitHub Actions automatically redeploys the website.

Your browser study database normally stays separate from website-code updates,
as long as the GitHub Pages URL/origin remains the same.
