# 🏆 House Captain Elections

A premium voting website for school House Captain and Vice House Captain elections.

## Features

- **4 House sections** — Red, Blue, Green, Yellow
- **Voter identity verification** — name, section, roll number
- **One-vote-per-roll-number** — prevents duplicate voting
- **4 vote categories** — House Captain (Boy/Girl) & Vice House Captain (Boy/Girl)
- **Admin dashboard** — add nominees with photos, manage data
- **Live results dashboard** — real-time vote tallies with leading indicator
- **Premium UI** — blue and matte black design

---

## Getting Started

Open `index.html` directly in a browser — no build step needed.

---

## Admin Access

Navigate to the site and click **Admin** in the top-right corner.

**Default password:** `admin1234`

> ⚠️ Change the password in `app.js` before deploying:
> ```js
> const ADMIN_PASSWORD = 'your-secure-password';
> ```

---

## Deploying to Vercel via GitHub

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/house-captain-elections.git
git push -u origin main
```

### Step 2 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"**
3. Import your `house-captain-elections` repository
4. Leave all settings as default (it's a static site)
5. Click **Deploy**

Your site will be live at `https://house-captain-elections.vercel.app` (or your custom domain).

---

## Data Storage

Votes and nominees are stored in the **browser's localStorage**. This means:

- Data persists across page refreshes on the same browser/device
- Each device/browser has its own copy — suitable for a single-kiosk setup
- For multi-device voting, you would need to integrate a backend (e.g. Firebase, Supabase)

---

## File Structure

```
house-captain-elections/
├── index.html      # Entry point
├── style.css       # All styles
├── app.js          # Application logic
├── vercel.json     # Vercel deployment config
├── .gitignore
└── README.md
```

---

## Customisation

| What | Where |
|---|---|
| Admin password | `app.js` → `const ADMIN_PASSWORD` |
| House names / colours | `app.js` → `const HOUSES` |
| Role names | `app.js` → `const ROLES` |
| Colour theme | `style.css` → `:root` variables |
| Election year label | `app.js` → hero eyebrow text |
