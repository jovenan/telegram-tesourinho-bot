# Assistente de finanças no Telegram

Bot pessoal de Telegram com um agente Claude que conversa livremente e cuida da planilha de gastos no Google Sheets: lança gastos (texto, foto de comprovante, PDF, extrato CSV), responde perguntas sobre os números, corrige e desfaz lançamentos e manda resumos semanais e mensais.

Toda alteração na planilha passa por uma prévia com botões ✅/❌ antes de ser gravada.

- Arquitetura e decisões: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Ambiente de desenvolvimento e testes: [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md)

## Como funciona

```
Telegram ─► Worker (Cloudflare, plano free) ─► Durable Object por chat (SQLite)
                                                  ├─ agente: Claude Sonnet 5.5 + ferramentas
                                                  ├─ Google Sheets (service account)
                                                  └─ histórico, memória, custos, log de escritas
```

- Um passo do agente por invocação (limite de 50 subrequests do plano free).
- Histórico append-only com compaction automática em conversas longas.
- Só responde ao `ALLOWED_USER_ID`, em chat privado.

## O que dá para fazer

| Exemplo | O que acontece |
|---|---|
| "gastei 45 no iFood no C6" | prévia do lançamento → ✅ → gravado com data, categoria e fonte |
| foto do cupom / PDF da fatura | extrai os gastos e propõe o lançamento em lote |
| CSV do extrato | lê o arquivo, ignora estornos/pagamentos, categoriza e propõe o lote |
| "comprei um fone de 400 em 4x" | uma parcela por mês nas abas existentes, avisa as que faltam |
| "muda o Cinemark para Presentes", "apaga o Uber", "desfaz" | edição, remoção e desfazer, sempre com prévia |
| "quanto gastei com mercado?", "compara com setembro" | lê o painel e os lançamentos do mês |
| "lembra que Uber é sempre Transporte no C6" | preferência guardada para as próximas conversas |

Proativos (horário de São Paulo): lembrete no sábado às 10h, resumo semanal no domingo às 19h e fechamento do mês no dia 1º às 9h.

Comandos: `/novo`, `/memoria`, `/custo`, `/cancelar`, `/ajuda`.

## Planilha esperada

Uma aba por mês chamada `Gastos MM/AAAA`, com o painel em A–B (Renda, Gastos, Saldos) e a tabela de gastos em C–G (`Data | Gasto | Fonte de saida | Categoria | Valor`), com dropdowns de fonte e categoria. Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md#planilha).

## Configuração

1. **Telegram:** crie o bot com o [@BotFather](https://t.me/BotFather) e descubra seu user id (por exemplo com o [@userinfobot](https://t.me/userinfobot)).
2. **Google:** crie uma service account com a Google Sheets API habilitada e compartilhe a planilha com o e-mail dela (Editor).
3. **Anthropic:** crie uma API key em [platform.claude.com](https://platform.claude.com). O custo típico é de alguns dólares por mês; o bot avisa ao chegar em 80% do teto mensal.
4. **Cloudflare:** plano free é suficiente (Durable Objects com SQLite).

```bash
bun install
bun run deploy

# secrets (uma vez)
bun run secret TELEGRAM_BOT_TOKEN
bun run secret TELEGRAM_WEBHOOK_SECRET   # qualquer string aleatória
bun run secret ALLOWED_USER_ID
bun run secret ANTHROPIC_API_KEY
bun run secret GOOGLE_CLIENT_EMAIL
bun run secret GOOGLE_PRIVATE_KEY
bun run secret GOOGLE_SPREADSHEET_ID

# aponta o bot para o Worker e registra o menu de comandos
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
WEBHOOK_URL=https://telegram-api-bot.<subdominio>.workers.dev/webhook \
bun run setup:telegram
```

Variáveis em `wrangler.toml` (`[vars]`): `CLAUDE_MODEL` (padrão `claude-sonnet-5-5`), `CLAUDE_EFFORT` (`medium`) e `MONTHLY_BUDGET_USD` (`15`). O teto também pode ser ajustado pelo próprio bot, no alerta de 80%.

## Desenvolvimento

```bash
bun run dev:telegram          # Telegram falso em :8798
bun run dev:worker            # Worker local, só enxerga abas "TESTE "
bun run dev:chat "oi"         # conversa com o bot pelo terminal
bun test && bun run typecheck
```

Veja [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md).
