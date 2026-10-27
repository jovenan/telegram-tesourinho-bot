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
bun run dev:chat --cron "0 13 * * sat"          # dispara o handler agendado
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

## Importação do cartão

No env `dev`, `BANK_SOURCE = "fake"` troca o Pluggy por `scripts/dev/fixtures/bank-transactions.json`: transações sintéticas com datas relativas a hoje, no cartão `fake-c6` (fonte `C6`). Elas incluem compras repetidas, estabelecimentos opacos, uma parcela, uma compra pendente, um pagamento de fatura e um estorno (os três últimos são filtrados).

```bash
bun run dev:chat "/sync"                         # busca e manda a prévia do lote
bun run dev:chat --click bank:save:<token>       # botões do lote e da revisão (callback_data impresso)
bun run dev:chat "/banco"                        # situação da importação
bun run dev:chat --cron "0 11 * * *"             # limpeza + sync, como o cron diário
```

As compras vão para a aba do mês da fatura, então as abas `TESTE` do mês seguinte precisam existir (`dev:sheets:setup`). Para recomeçar do zero, use `--new-chat` (outro Durable Object) ou apague `.wrangler/state/v3/do/`.

Para olhar a conexão real do Meu Pluggy sem gravar nada, ponha `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `PLUGGY_ITEM_IDS` no `.dev.vars` e rode a sonda:

```bash
bun scripts/dev/pluggy-probe.ts          # contas, status, quais campos vêm preenchidos
bun scripts/dev/pluggy-probe.ts --full   # também lista as transações do cartão (só no seu terminal)
```

Ela mostra os ids das contas de crédito para o `PLUGGY_ACCOUNTS`. Não cole a saída do `--full` em lugar nenhum: são dados reais.

## Bot de teste (staging)

Um segundo bot do Telegram (criado no @BotFather só para testes) aponta para o Worker `telegram-api-bot-staging`, com Telegram, Cloudflare e planilha reais. Escritas continuam passando pela aprovação no chat.

```bash
bun run deploy:staging   # publica o código atual no staging
bun run logs:staging     # logs ao vivo
```

Os secrets do staging (token do bot de teste, `ALLOWED_USER_ID`, chaves da Anthropic e do Google, `DEBUG_TOKEN`) ficam só no Cloudflare. Para limitar o staging às abas de teste, adicione `SHEETS_SANDBOX_PREFIX = "TESTE "` em `[env.staging.vars]`.

Para ver o que o agente fez numa conversa:

```bash
curl -H "Authorization: Bearer $DEBUG_TOKEN" "https://telegram-api-bot-staging.<subdominio>.workers.dev/debug/messages?limit=100"
```

## Banco e testes

```bash
bun run db:generate   # gera migração em src/db/migrations após mudar src/db/schema.ts
bun test              # testes unitários (test/)
bun run typecheck
```

Para zerar o estado local dos Durable Objects, apague `.wrangler/state/v3/do/`.
