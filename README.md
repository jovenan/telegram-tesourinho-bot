# Telegram Expenses Bot

A Telegram bot to track expenses and save them to Google Sheets.

## Features

- Register expenses via conversation flow
- Categories and sources fetched dynamically from the spreadsheet
- Saves data directly to Google Sheets

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

### 4. Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `GOOGLE_SPREADSHEET_ID` | ID from the spreadsheet URL |
| `GOOGLE_SHEET_NAME` | Sheet tab name (e.g., "Gastos") |
| `GOOGLE_CLIENT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Private key from JSON credentials |

### 5. Run

```bash
bun run dev
```

### 6. Set webhook

After deploying, set the webhook:

```
GET /set-webhook?url=https://your-domain.com
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
- `/gasto` - Start expense registration
- `/cancelar` - Cancel current operation

## Project Structure

```
src/
├── index.ts     # HTTP routes
├── bot.ts       # Conversation logic
├── sheets.ts    # Google Sheets API
├── config.ts    # Messages
└── types.ts     # TypeScript interfaces
```
