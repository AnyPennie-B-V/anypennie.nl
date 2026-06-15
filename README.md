# 🍾 Any Pennie Scoreboard & Ledger

An interactive dashboard, scoreboard, and ledger system designed for tracking **Anytimers** (Any Pennies) for study association treasurers. It provides a shared, transparent, and auditable record of who still has anys left to take.

The project features a sleek, premium dark-mode user interface with glassmorphism visual elements, custom 3D isometric showcase boxes, and real-time ledger updates.

---

## 📖 Definition of an Any Pennie

An **Any Pennie** (commonly referred to as an "Any") is formally defined as a binding obligation requiring the sequential and uninterrupted consumption of the following:
1. **Primary Consumption**: The complete consumption of one (1) 0.5L can of Grolsch Kanon (11.6% ABV).
2. **Subsequent Consumption**: Immediately following the primary consumption, the consumption of one (1) traditional borrel of Ketel 1 ambachtelijke jonge graanjenever (35% ABV).

Failure to comply with both conditions in this exact chronological order invalidates the redemption, keeping the outstanding balance unchanged in the official Ledger.

---

## 🚀 Features

- **Dashboard / Scoreboard**: A real-time grid of all tracked individuals showing their outstanding Any Pennie balance, custom avatar, role, and a fun fact.
- **Ledger System**: A transparent, chronological log of all Any Pennie activities showing dates, quantities, remaining balances, auditor names, and notes.
- **Admin Portal**: Password-protected workspace for Treasurers to:
  - **Log Any Received**: Record when an Any has been assigned to a person.
  - **Log Any Taken**: Fulfill outstanding Any Pennies.
  - **Manage Profiles**: Register new people or update their name, role, board number, profile image URL, and fun facts.
  - **Danger Zone**: Purge a specific person's profile and transactions, or clear the entire ledger history.
- **Dual-Mode Persistence**:
  - **Local Development**: Persistent storage via a local `data.json` file.
  - **Production (Vercel)**: Automatically switches to **Vercel KV** (Redis) with a fallback to memory to support serverless environments.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Backend**: Node.js serverless functions (standard `http` module emulation).
- **Hosting / Serverless Platform**: Vercel.
- **Database**: Vercel KV (Redis) / Local JSON.

---

## 💻 Local Setup & Development

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed.

### 2. Run the App
To start the local development server:
```bash
npm run dev
```
or:
```bash
node server.js
```

The app will start at [http://localhost:3000](http://localhost:3000).

---

## ⚙️ Configuration (Environment Variables)

To configure the application locally, copy the `.env.example` template to a new file named `.env`:
```bash
cp .env.example .env
```

Since `.env` is listed in your `.gitignore`, it is kept completely private and will not be pushed to GitHub. Update the values in `.env` as needed:

| Environment Variable | Description | Default (if unset) |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | The password required to authenticate admin actions. | `admin123` |
| `KV_REST_API_URL` | Vercel KV REST API endpoint URL (for production storage). | *(Uses local `data.json` if empty)* |
| `KV_REST_API_TOKEN` | Vercel KV REST API read/write token. | *(Uses local `data.json` if empty)* |

---

## ☁️ Deployment (Vercel)

The app is fully configured to be deployed on Vercel:

1. Install the Vercel CLI or link the repository to your Vercel account.
2. Run the deploy command:
   ```bash
   vercel
   ```
3. Set your production environment variables (`ADMIN_PASSWORD`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`) in the Vercel Dashboard.
4. Promote to production:
   ```bash
   vercel --prod
   ```
