# Expense Tracker · Save first

**Save first. Spend what's left. Never miss an EMI.**

A mobile-first web app for people in Nepal and the Nepali diaspora (NZ, US). It shows how much is really **left to spend** after EMIs, bills and savings are kept aside, reminds you before things are due, and helps you save toward goals without pressure.

Plain HTML, CSS and JavaScript, no build step. **Supabase** provides sign-in, the Postgres database and private file storage. Without Supabase keys it runs in local mode and keeps data in the browser.

## Features

- **Left to spend:** money in your accounts minus everything due in the next 30 days (EMIs, bills, savings), with a daily amount until your next income. Savings accounts aren't counted as spendable.
- **Plan:** one form with a switch between **Bills & EMIs** and **Savings goal**.
  - Bills & EMIs: EMI, rent, bill, subscription, insurance; monthly or one-time; EMI total and progress; reminders; mark paid, skip a month.
  - Savings goals: target and date, a suggested monthly step, a savings account to keep it in. Nothing is logged automatically: you move the money, then tap "I moved it".
- **Recurring income:** salary and rent received, with "Got it", "Other amount" or "Not yet". Income only counts once you confirm it arrived.
- **Nepali (BS) and English (AD) calendars**, chosen per user and per plan.
- **Accounts:** add any bank, wallet, cash or credit card, as many as you like. Names are free text, with tap-to-fill suggestions (Nepali banks and wallets first, then NZ and US ones as you type). Savings accounts are kept out of Left to spend.
- **Payment QR:** take a photo of your QR or choose a screenshot. The app finds the code (even in an angled photo), crops a clean copy for sharing, and fills in the name, account or wallet ID and bank. It reads NepalQR/Fonepay/NepalPay (EMVCo), wallet QRs in JSON, payment links (Venmo, PayPal, Zelle, Cash App), phone numbers and NZ account numbers. Filled fields are marked "From QR" so you can check them. Uses the browser's built-in reader where available, otherwise jsQR (`js/vendor`, loaded only when needed).
- **Add money in or out:** expense, income, transfer, lend/borrow, with a keypad, categories, bills and payment slips (camera, gallery or PDF).
- **Activity:** search and filters (date range, account, category, tag, with slip), with a filtered total.
- **Reports:** spending by category, budget, comparison with last month, income by source.
- **Sign-in without passwords:** Google, Apple, or a 6-digit code by email. You can start without an account and back up later; your data comes with you.
- **Onboarding:** 3-screen walkthrough, calendar choice, set up your money or explore sample data, and a getting-started checklist.
- **Pro trial and invites** (placeholders, no payments yet): 14-day trial, free plan limited to 2 savings goals, invite link.
- **Sign out** removes the data from this device; it stays in your account. **Delete account** removes the account, all rows and all files.
- Light, dark or system theme. CSV export. Undo on every change. Installable as a home-screen app.

## Project structure

```
Expense-calculator/
├── index.html            # App shell
├── css/styles.css        # Design tokens (light/dark) and components
├── js/
│   ├── config.js         # Supabase URL and anon key (public by design; data is protected by RLS)
│   ├── store.js          # Sign-in and sync: Supabase Auth, writes only changed rows, uploads files
│   ├── vendor/jsQR.min.js # QR reader (Apache-2.0), loaded on demand
│   └── app.js            # The app: screens, calculations, plans, goals, onboarding
├── supabase/schema.sql   # Tables, Row Level Security, triggers, storage bucket, v3 additions
├── assets/               # Icons
├── manifest.webmanifest  # Install as an app
└── vercel.json           # Static hosting config
```

## Run locally

```bash
python3 -m http.server 8080
# or: npx serve .
```

Open http://localhost:8080. Use Chrome's device toolbar to see the phone layout. On a desktop screen the app shows as a centred phone-width column.

Google and Apple sign-in redirect back to the page, so add `http://localhost:8080/**` to Supabase redirect URLs if you want to test them locally. The email code works without that.

## Supabase setup

Project `expense-calculator` (ap-south-1, Mumbai). `js/config.js` already points to it and the v3 schema is applied.

| Table | Holds |
| --- | --- |
| `profiles` | Name, theme, default account, budget, and all app settings (`settings` jsonb) |
| `accounts` | Banks, wallets, cash, cards, savings accounts (`savings`), receive-money details |
| `commitments` | EMIs, rent, bills, subscriptions, savings goals and monthly savings |
| `incomes` | Recurring income: salary, rent received |
| `transactions` | Expenses, income, transfers, lend/borrow, repayments; attachment paths |
| Storage `attachments` | Bills, slips and QR codes, private, one folder per user |

Each row keeps the full app object in a `data` jsonb column; the other columns are for reports and queries. Every table uses Row Level Security, so users only see their own rows.

To use your own Supabase project: SQL Editor → run `supabase/schema.sql` → paste your Project URL and anon key into `js/config.js`.

### One-time dashboard steps (needed for sign-in)

1. **URL Configuration** (Authentication → URL Configuration)
   - Site URL: your live address, for example `https://expense-calculator.vercel.app`
   - Redirect URLs: add `https://expense-calculator.vercel.app/**` (and `http://localhost:8080/**` for local testing)
2. **Email code** (Authentication → Email Templates → Magic Link): put the code in the email, for example:
   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```
   Also set the email OTP length to 6 (Authentication → Providers → Email). For real users, set up custom SMTP (Project Settings → Authentication → SMTP); the built-in sender is rate-limited.
3. **Google** (Authentication → Providers → Google): create an OAuth client in Google Cloud Console (Web application), add `https://nkdyanuudxkwowerxecs.supabase.co/auth/v1/callback` as an authorised redirect URI, then paste the client ID and secret into Supabase.
4. **Apple** (Authentication → Providers → Apple): needs an Apple Developer account (Services ID, key, team ID). Until it's set up, the Apple button tells users to use email.

## Deploy

Push to GitHub, then import the repo in Vercel (framework preset: **Other**, no build command, output directory: root). Every push to `main` redeploys. Then do step 1 above with the Vercel address.

## Not built yet

- Payments for Pro (the trial and goal limit work locally; price and limit are placeholders).
- Family sharing.
- Push or email reminders (reminders show inside the app).
- Invite rewards tracking (the invite link shares the app address).
