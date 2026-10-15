# Ambiente de desenvolvimento

Permite conversar com o bot localmente, sem Telegram real e sem risco para os dados reais da planilha.

```
chat CLI ──webhook──► wrangler dev --env dev (Worker + ChatDO)
                          │            │
                          │            └─► Google Sheets (só escreve em abas "TESTE ")
                          └─► fake Telegram (localhost:8798) ◄── chat CLI lê as respostas
```

## Garantias

- **Telegram:** o env `dev` aponta `TELEGRAM_API_ROOT` para `scripts/dev/fake-telegram.ts`. Nenhuma mensagem chega ao Telegram real; o token é substituído por `dev`.
- **Planilha:** `SHEETS_SANDBOX_PREFIX = "TESTE "` faz o `SheetsClient` recusar qualquer escrita (update, clear, batchUpdate) em aba cujo nome não comece com `TESTE `, antes de qualquer request de escrita. O agente também só enxerga e lê abas `TESTE`, então os testes não levam dados reais para a API.
- **Anthropic:** usa a `ANTHROPIC_API_KEY` real do `.dev.vars`. Testes consomem crédito de verdade (~US$ 0,004 por chamada); o env `dev` tem teto de US$ 2.

## Uso

Em dois terminais:

```bash
bun run dev:telegram   # fake Telegram em :8798
bun run dev:worker     # Worker em :8787 (env dev, com --test-scheduled)
```

Conversando:

```bash
bun run dev:chat "quanto gastei com mercado?"
bun run dev:chat --photo cupom.jpg "legenda"    # arquivo em scripts/dev/fixtures/
bun run dev:chat --doc extrato-nubank.csv
bun run dev:chat --doc cupom.pdf
bun run dev:chat --click approve:<token>        # callback_data de um botão exibido
bun run dev:chat --cron "0 13 * * 6"            # dispara o handler agendado
bun run dev:chat --state                        # tabelas do Durable Object do chat
bun run dev:chat --new-chat                     # próximas mensagens vão para um chat novo
```

O CLI usa o usuário `1` (o `ALLOWED_USER_ID` do env `dev`) e guarda contadores em `scripts/dev/.chat-state.json`.

## Abas de teste

```bash
bun run dev:sheets:setup   # cria "TESTE Gastos 10/2026", 11 e 12 a partir de "Gastos 12/2026"
bun run dev:sheets:seed    # limpa e preenche as abas TESTE com dados fictícios
```

O setup duplica a aba modelo, mantendo formatação, dropdowns e as fórmulas do painel A–B, e limpa todos os valores reais da cópia: a tabela C–G, a renda (A2:B5) e notas soltas em H–K. É idempotente; `--recreate` apaga e recria as abas TESTE. O seed pode ser rodado a qualquer momento para voltar a um estado conhecido.

No env `dev`, o agente usa `TESTE Gastos MM/YYYY` como aba do mês.

Fixtures fictícias (CSV de extrato, cupom em PDF e em JPG) são geradas com `bun run dev:fixtures`.

Para testar a compaction ou o alerta de teto sem esperar, suba o worker com limites baixos:

```bash
bunx wrangler dev --env dev --test-scheduled --var TELEGRAM_BOT_TOKEN:dev --var TELEGRAM_WEBHOOK_SECRET:dev-secret --var COMPACT_AT_TOKENS:2000
bunx wrangler dev --env dev --test-scheduled --var TELEGRAM_BOT_TOKEN:dev --var TELEGRAM_WEBHOOK_SECRET:dev-secret --var MONTHLY_BUDGET_USD:0.05
```

Os crons são disparados com `bun run dev:chat --cron "<expressão>"` (ver `src/proactive`). Como em chat privado o id do chat é o id do usuário, eles vão para o chat `1`.

## Banco e testes

```bash
bun run db:generate   # gera migração em src/db/migrations após mudar src/db/schema.ts
bun test              # testes unitários (test/)
bun run typecheck
```

Para zerar o estado local dos Durable Objects, apague `.wrangler/state/v3/do/`.
