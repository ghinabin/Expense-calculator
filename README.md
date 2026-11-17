# Expense Calculator

A mobile-first web app for tracking where your money goes. You record what you pay, which account it came from, and attach the bill or payment slip. You also plan EMIs and recurring bills ahead of time.

It is plain HTML, CSS and JavaScript, with no build step and no backend. Data is stored in the browser on the device.

## Features

- **Login and registration.** Accounts are stored on the device, and passwords are saved as SHA-256 hashes.
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
├── login.html            # Log in
├── register.html         # Create account
├── css/
│   ├── styles.css        # Design tokens (light/dark) and app components
│   └── auth.css          # Login and registration layout
├── js/
│   ├── auth.js           # Users, sessions, password hashing, form handling
│   └── app.js            # Balances, transactions, EMIs, budget, reports, settings
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

## Demo account

The email `ghinabin@gmail.com` is set up as a demo account with sample data. Its password is not stored in the code, only its hash. New accounts start empty with a single Cash account.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, choose **Add New → Project** and import the repo.
3. Set Framework Preset to **Other**. Leave the build command and output directory empty, then deploy.

Or from a terminal in this folder, run `npx vercel` (then `npx vercel --prod`).

## Limits of this version

- Login is client-side only. It keeps people out of each other's data on a shared phone, but it is not real security. Add a backend (for example Supabase or Firebase Auth) before storing real users' data.
- Data does not sync between devices. Use Settings → Export to copy a CSV.
