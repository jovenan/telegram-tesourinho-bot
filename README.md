# Telegram Expenses Bot

A Telegram bot to track expenses and save them to Google Sheets, powered by AI for automatic expense extraction from images and text.

## Features

- Register expenses manually via conversation flow
- AI-powered expense extraction from photos (receipts, bank statements)
- AI-powered expense extraction from text (`/ai` command)
- Support for multiple expenses in a single image
- Inline keyboard buttons for easy confirmation
- Edit individual fields (description, value, source, category)
- Categories and sources fetched dynamically from the spreadsheet
- Saves data directly to Google Sheets
- Deployed on Cloudflare Workers (free tier)

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Create a Telegram Bot

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the token

### 3. Configure Google Sheets

1. Create a Google Cloud project
2. Enable the Google Sheets API
3. Create a Service Account and download the JSON credentials
4. Share your spreadsheet with the service account email

### 4. Get Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key

### 5. Environment variables

Create a `.dev.vars` file for local development:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
ANTHROPIC_API_KEY=your_anthropic_key
TELEGRAM_WEBHOOK_SECRET=random_secret_string
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEET_NAME=Sheet Name
```

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `ANTHROPIC_API_KEY` | API key from Anthropic |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook validation |
| `GOOGLE_SPREADSHEET_ID` | ID from the spreadsheet URL |
| `GOOGLE_SHEET_NAME` | Sheet tab name (e.g., "Gastos 03/2026") |
| `GOOGLE_CLIENT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Private key from JSON credentials |

## Running Locally

```bash
npx wrangler dev
```

This reads `.dev.vars` automatically and simulates the Cloudflare Workers environment.

To test with Telegram, use ngrok to expose your local server:

```bash
ngrok http 8787
```

Then set the webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-ngrok-url.ngrok-free.app/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

## Deploy to Cloudflare Workers

### 1. Deploy

```bash
npx wrangler deploy
```

### 2. Add secrets

Via terminal:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_SPREADSHEET_ID
npx wrangler secret put GOOGLE_SHEET_NAME
```

Or via Cloudflare Dashboard:
1. Go to https://dash.cloudflare.com
2. Workers & Pages → your worker
3. Settings → Variables and Secrets

### 3. Set webhook

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker.your-subdomain.workers.dev/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

To check webhook status:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

To remove webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"
```

## Spreadsheet Structure

The bot expects these columns:

| Column | Content |
|--------|---------|
| D | Description |
| E | Source |
| F | Category |
| G | Value |

Sources and categories are read from existing values in columns E and F.

## Commands

- `/start` - Welcome message
- `/gasto` - Start manual expense registration
- `/ai [text]` - Extract expense from text using AI
- `/cancelar` - Cancel current operation
- Send a photo - Extract expenses from image using AI

## AI Features

### Photo Analysis

Send a photo of a receipt, bank statement, or any document with expenses. The bot will:
1. Extract all expenses from the image
2. Show each expense one by one
3. Let you confirm, skip, or edit each one

### Text Analysis

Use `/ai` followed by expense description:

```
/ai Almoço no restaurante 45,90 no débito
```

### Adding Custom Description

When confirming an expense, you can add a custom suffix:

```
add Ração do cachorro
```

This will save as: `AGROPETHORSE SOROCABA - Ração do cachorro - AI GENERATED`

## Project Structure

```
src/
├── index.ts      # HTTP routes (Hono)
├── bot.ts        # Conversation logic & Telegram API
├── anthropic.ts  # AI expense extraction
├── sheets.ts     # Google Sheets API (fetch-based)
├── telegram.ts   # Telegram file utilities
├── config.ts     # Messages
└── types.ts      # TypeScript interfaces
```

## Security

- Webhook endpoint protected by `TELEGRAM_WEBHOOK_SECRET`
- All AI-generated expenses are marked with `- AI GENERATED` suffix
