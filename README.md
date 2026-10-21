# Kalye East Varrio Funds Tracker

The web interface is hosted on Vercel. Google Apps Script remains the server-side backend for Google Sheets and Drive, preserving the existing sheet layout and transaction validation. The Vercel API proxies a small allowlist of tracker operations to the Apps Script web app; spreadsheet and Drive access are never placed in browser code.

## Publish on Vercel

1. In the existing spreadsheet's **Extensions → Apps Script** project, replace `Code.gs` and `appsscript.json` with the versions in this folder. Save, then run `getAppData` and `getBranding` in the Apps Script editor and approve the requested permissions. This creates any missing `FT ...` tabs and checks access to the logo in `Images!B2`.
2. In Apps Script, choose **Deploy → New deployment → Web app**. Set **Execute as** to your account and **Who has access** to **Anyone**, then deploy. This is required for the Vercel server to call the backend. Copy the web app URL ending in `/exec`.
3. Push this folder to a GitHub repository and import it as a project in Vercel. No build command or framework preset is required; Vercel serves `KEV.html` and deploys `api/index.js` as a serverless API route.
4. In Vercel project **Settings → Environment Variables**, add `APPS_SCRIPT_API_URL` with the Apps Script `/exec` URL. Apply it to the environments you will deploy, then redeploy.
5. Open the Vercel deployment URL and test with non-sensitive sample entries before using live fund data.

The blue-and-black dashboard with a larger sidebar logo, condensed display title, and plain dark background is served from `KEV.html`. The optional logo continues to load from `Images!B2`.

## Test locally on Windows

1. Install Node.js LTS if it is not already installed. Open PowerShell in this project folder (`D:\KEV`).
2. Deploy the Apps Script backend first, following steps 1–2 above. For safer testing, make a **copy of the spreadsheet**, create a separate Apps Script project for that copy, and set `SPREADSHEET_ID` in that copy's `Code.gs` to the copied spreadsheet ID before deploying it. The current Apps Script project writes to the configured spreadsheet even when its frontend is running on your computer.
3. Set the Apps Script URL for this PowerShell session and start the local Vercel development server:

   ```powershell
   $env:APPS_SCRIPT_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
   npx.cmd vercel dev
   ```

   Replace the example URL with the Apps Script web app URL ending in `/exec`. If prompted, sign in to Vercel and link or create a project. Vercel CLI may ask to install itself; allow that prompt.
4. Open the local URL shown in the terminal, usually `http://localhost:3000`. Try loading the dashboard, creating a monitoring, adding a sample contribution, and checking that its monitoring total updates. Confirm the spreadsheet copy changes as expected.
5. Stop the local server with **Ctrl+C**. The environment variable is only set for that PowerShell session.

To test only that the server starts without connecting to Google, run `npx.cmd vercel dev` without setting `APPS_SCRIPT_API_URL`; the page should load, but data requests will show a configuration error. To test real tracker behavior, use a test spreadsheet rather than live funds.

## Public access warning

This deployment intentionally has no sign-in. Anyone with the Vercel URL can view records and use the tracker to add, edit, void, or configure data. The Apps Script endpoint is also deployed with public access, and the tracker records edits as **Public user** rather than identifying who made them. Do not use this configuration for confidential or high-risk financial data. To restrict access later, add authentication and authorization before exposing either the Vercel API or Apps Script backend.

## Features

- **Funds & forms:** Record additions by member and monitoring, or general deductions against the selected monitoring. Edit or void transactions; configure optional and required transaction fields.
- **Monitoring:** Create multiple monitoring forms, add members and date columns, view read-only contribution values, visible general-deduction rows, and net totals. Copy the table for spreadsheet use.
- **Audit logs:** Review activity recorded through the tracker.
- **Master list:** Search members across active monitoring forms and review their monitoring forms, total contributions, and latest contribution date.
- **About:** Shows the Kalye East Varrio name, Temple Street Trece detail, guiding values, tracker purpose, and public-access notice.
- Existing addition transactions without a monitoring ID are displayed under the first active monitoring for compatibility.

Amounts are limited to two decimal places. The app does not assign a currency symbol; use one currency consistently in the spreadsheet.
