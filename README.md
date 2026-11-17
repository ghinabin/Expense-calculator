# Expense Calculator

A mobile-first web app for tracking where your money goes. You record what you pay, which account it came from, and attach the bill or payment slip. You also plan EMIs and recurring bills ahead of time.

It is plain HTML, CSS and JavaScript with no build step. **Supabase** provides sign-in, the Postgres database and file storage for bills and slips. If no Supabase keys are set, it falls back to a local mode where data stays in the browser.

## Features

- **Login, registration and password reset** through Supabase Auth (email and password).
- **Cloud data:** every account, transaction, EMI and setting is saved to Postgres, and each user can only read their own rows (Row Level Security). Log in on any phone to see the same data.
- **Accounts:** banks, wallets (eSewa, Khalti), cash and credit cards. Each balance is calculated from its opening balance plus every transaction.
- **Add money in or out** from one screen with four tabs: Expense, Income, Transfer, Lend/Borrow. It has a keypad, a category grid and account chips that show each balance.
- **Bills and payment slips:** one picker for camera, gallery or PDF, up to 5 files per transaction.
- **EMIs, rent, bills and subscriptions:** due dates, overdue status, one-tap pay, skip a month, and EMI progress.
- **Budget:** an overall limit and per-category limits, with alerts at 80% and 100%. Paid EMIs count toward the budget.
- **Reports:** spending by category, comparison with last month, daily spending, which account you paid from, and income by source.
- **Lend and borrow:** "Owed to me" and "I owe" totals, with partial repayments.
- **Settings:** light, dark or system theme; month start day (calendar month or payday); default account; CSV export.
- **Undo:** every save, delete or change can be undone for a few seconds.
- **Installable:** works as a home-screen app on Android and iOS through the web app manifest.

## Project structure

```
Expense-calculator/
├── index.html            # App shell; redirects to login when signed out
├── login.html            # Log in, forgot password
├── register.html         # Create account
├── reset.html            # Set a new password from the email link
├── css/
│   ├── styles.css        # Design tokens (light/dark) and app components
│   └── auth.css          # Login and registration layout
├── js/
│   ├── config.js         # Supabase URL and anon key
│   ├── store.js          # Data + sign-in layer: Supabase sync (only changed rows) or local mode
│   ├── auth-pages.js     # Login, register and reset forms
│   ├── auth.js           # Local-mode accounts (used only without Supabase keys)
│   └── app.js            # Balances, transactions, EMIs, budget, reports, settings
├── supabase/
│   └── schema.sql        # Tables, Row Level Security, new-user trigger, storage bucket
├── assets/               # App icons and favicon
├── manifest.webmanifest  # Install as an app on phones
├── vercel.json           # Static hosting config (clean URLs)
└── README.md
```

## Run locally

Open `index.html` in a browser. Or serve the folder so it behaves like the hosted version:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed address on your phone (same Wi-Fi) or in Chrome's mobile view.

## Supabase setup

The project `expense-calculator` (region ap-south-1, Mumbai) is already created, with `supabase/schema.sql` applied. `js/config.js` points to it.

| Table | Holds |
| --- | --- |
| `profiles` | Name, month start day, default account, theme, budget limits (one row per user) |
| `accounts` | Banks, wallets, cash, cards with opening balance |
| `transactions` | Expenses, income, transfers, lend/borrow, repayments, corrections; attachment paths |
| `commitments` | EMIs, rent, bills, subscriptions with due day and paid dates |
| Storage `attachments` | Bill and slip files, private, in a folder per user |

A new sign-up automatically gets a profile and a Cash account with a balance of 0, so every user starts from an empty state.

To set up your own project instead, open Supabase → SQL Editor, run `supabase/schema.sql`, then paste your Project URL and anon key into `js/config.js` (Project Settings → API).

**After deploying**, in Supabase go to Authentication → URL Configuration:
- Set **Site URL** to your live address (for example `https://expense-calculator.vercel.app`).
- Add `https://expense-calculator.vercel.app/**` to **Redirect URLs**.

Without this, confirmation and password-reset emails open the wrong address.

Supabase's built-in email sender is limited to a few messages per hour. For testing, you can turn off Authentication → Providers → Email → **Confirm email**. For real users, set up custom SMTP.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, choose **Add New → Project** and import the repo.
3. Set Framework Preset to **Other**. Leave the build command and output directory empty, then deploy.

Or from a terminal in this folder, run `npx vercel` (then `npx vercel --prod`).

## Limits of this version

- Changes save about half a second after each edit. If the phone is offline, the app retries every few seconds and again when the connection returns, but changes made while offline are lost if the app is closed before it reconnects.
- If two phones edit the same item at nearly the same moment, the last save wins.
