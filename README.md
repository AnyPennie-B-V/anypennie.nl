# 🍾 Treasurer's Bottle Scoreboard

A scoreboard and ledger system designed for tracking study association beverage consumption (specifically **Grolsch Kanon** and **Ketel 1**) and debt management. It includes a password-protected admin portal to log consumption, record payments, manage pricing, and view/delete transaction logs.

The project features a sleek dark-mode user interface with custom SVG visualizations and real-time ledger updates.

---

## 🚀 Features

- **Beverage Tracking**: Track total consumption counts and prices for Grolsch Kanon and Ketel 1.
- **Admin Portal**: Password-protected actions including logging drinks, registering payments, updating prices, and deleting/clearing the transaction history.
- **Ledger System**: A transparent, chronological log of all consumption and payments.
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
