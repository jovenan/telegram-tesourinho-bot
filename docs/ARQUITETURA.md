# Arquitetura: agente de finanças no Telegram

O bot deixa de ser um extrator com fluxo fixo e passa a ser um agente com quem se conversa livremente pelo Telegram. O agente lê e escreve na planilha do Google Sheets através de ferramentas, guarda histórico de conversa e memória de longo prazo, e pede confirmação antes de qualquer escrita.

## Decisões técnicas

| Tema | Decisão | Motivo |
|---|---|---|
| Infra | Cloudflare Worker (plano free) + Durable Object com SQLite | Custo de infra zero. O Claude Agent SDK precisa de subprocesso e disco, o que no Cloudflare só existe em Containers (Workers Paid). |
| Agente | Loop próprio com `@anthropic-ai/sdk`, um passo por alarm do DO | O plano free limita 50 subrequests por invocação. Um passo por invocação nunca estoura o limite, permite pausar para aprovação e retomar após falhas. |
| Modelo | `claude-sonnet-5-5`, effort `medium`, thinking adaptativo | Recomendação da doc para chat com tool use. Cache read a 5% do input. |
| Ferramentas | Schemas zod, portáveis para MCP (`createSdkMcpServer`) | O código resolve abas e colunas; o modelo decide o quê, não o como. |
| Telegram | `Api` do grammY + `@grammyjs/auto-retry`, resposta em HTML simples | Tipado, roda em Workers. |
| Acesso | Allowlist com `ALLOWED_USER_ID`; demais usuários são ignorados | Hoje o bot é aberto. |
| Proativos | Cron Triggers do Worker (grátis) acionando o DO do chat | |
| Banco | Drizzle ORM (`drizzle-orm/durable-sqlite`), migrações geradas pelo `drizzle-kit` | Schema e queries tipados; migrações versionadas aplicadas no start do DO. |
| Testes | `bun test` para funções puras e para a trava de escrita do Sheets | Já vem com o Bun; sem dependência extra. |

## Produto

### Conversa
- Personalidade: o **Grana**, um mordomo financeiro formal e discreto, que trata o usuário por "senhor" e tem um humor seco raro. É uma seção do system prompt (`src/agent/prompt.ts`) e também o tom das mensagens fixas (`src/messages.ts`).
- Respostas curtas por padrão (1 a 3 frases), sem justificar escolhas nem oferecer mais coisas no fim. A brevidade vale acima da personalidade.
- Prévias e confirmações seguem formato fixo e escaneável.
- Histórico por conversa; `/novo` recomeça. Memória de longo prazo (`remember`/`forget`) sobrevive ao `/novo`.
- Comandos: `/novo`, `/memoria`, `/custo`, `/cancelar`, `/ajuda`. Os fluxos antigos (`/gasto`, `/ai`) saem.
- Escopo: só finanças e planilha, sem web. Perguntas gerais são respondidas com o conhecimento do modelo.

### Escrita na planilha
- Toda escrita pede confirmação por botão.
- Informação faltando: o agente sempre pergunta. Em lote, pergunta uma vez para o lote inteiro.
- Lote (foto com vários itens, CSV): prévia única com lista e total, botões "Gravar tudo" / "Cancelar", ajustes por texto ("tira o 3", "o 2 é Lazer").
- Texto enviado com aprovação pendente conta como recusa com feedback; o agente refaz a proposta.
- `/cancelar` durante um turno é atendido antes do próximo passo e fica registrado no histórico, para o agente não retomar o pedido.
- Duplicados: antes de gravar, compara com a aba do mês (mesmo valor + descrição parecida) e marca ⚠️ na prévia.
- Desfazer: cada escrita fica registrada (aba, linhas, valores anteriores). "Desfaz o último" reverte, também com aprovação.
- Parcelas: "300 em 3x" cria `Descrição (1/3)` no mês atual e `(2/3)`, `(3/3)` nas abas seguintes, se existirem; avisa as que faltam.
- Data do gasto é gravada na coluna C.
- Lançamentos feitos pelo `add_expense` (inclusive de fotos e CSV) mantêm o sufixo `- AI GENERATED` na descrição.
- Pode apagar linhas (com aprovação). Nunca apaga, cria ou renomeia abas.
- Renda (A–B): o agente lê para resumos e saldo, mas só altera quando o usuário pedir explicitamente.

### Proativos (horário de São Paulo)
| Quando | O quê |
|---|---|
| Sábado 10h | Lembrete para lançar os gastos da semana |
| Domingo 19h | Resumo semanal por categoria, comparado à semana anterior |
| Dia 1º, 9h | Fechamento do mês anterior + lembrete de criar a aba nova, se não existir |

Cron em UTC (São Paulo = UTC−3): `0 13 * * sat`, `0 22 * * sun`, `0 12 1 * *`. No Cloudflare, 1 = domingo e 7 = sábado; por isso os nomes dos dias.

O resumo semanal depende da data na coluna C. Lançamentos manuais sem data ficam de fora; o resumo informa quantos foram ignorados.

### Custo
- Teto mensal configurável (`MONTHLY_BUDGET_USD`).
- Ao chegar em 80%, o bot avisa com botões: aumentar teto / trocar para Haiku 5.5 / continuar. Nada é bloqueado automaticamente.
- `/custo` mostra o gasto do mês.

## Planilha

- Abas mensais `Gastos MM/YYYY`, criadas manualmente e com antecedência. O agente avisa se a aba do mês não existir.
- Uma aba é "de gastos" pelo **layout**, não pelo nome: cabeçalhos `Data | Gasto | Fonte de saida | Categoria | Valor` em C1:G1. Cópias e abas renomeadas recebem as mesmas regras (validação dos dropdowns, proteção do painel, crescimento da tabela). As ferramentas de gastos aceitam o nome de uma dessas abas no campo `sheet`, no lugar do mês.
- Abas ocultas (meses antigos, faturas, planejamento etc.) não aparecem em `list_sheets` por padrão; o agente acessa quando o usuário pede pelo nome.
- Cada aba tem duas áreas:

**A–B: painel do mês**

| Linhas | Seção | Conteúdo |
|---|---|---|
| 2–5 | Renda | lançamentos de renda; linha 3 é o VA/VR (pareado com o cartão Flash) |
| 6 | Total renda | `=SUM(B2:B5)` |
| 9–21 | Gastos | `SUMIF(E2:E125; fonte; G2:G125)` por fonte, Total Geral e Total Geral sem Flash |
| 24–29 | Saldos | Saldo sem VA/VR, Saldo VA/VR, Saldo Geral |

**C–G: tabela de gastos (com filtro)**

| Coluna | Conteúdo |
|---|---|
| C | Data |
| D | Gasto (descrição) |
| E | Fonte de saída (dropdown) |
| F | Categoria (dropdown estrito) |
| G | Valor |

- Para resumos do mês, o agente lê o painel A1:B29 (totais por fonte e saldos já calculados pela planilha) em vez de somar linha a linha.
- Renda: o agente altera apenas as células de lançamento (A2:B5) e só quando pedido. Nunca escreve em B6 nem nas seções Gastos/Saldos.
- As opções de fonte e categoria são lidas da validação de dados da própria aba, não ficam fixas no código.
- A API de valores não respeita a validação do dropdown, então o código valida antes de gravar.
- A próxima linha livre é calculada pela coluna D. Meses futuros já vêm com lançamentos pré-preenchidos (parcelas/recorrentes), então a posição nunca é presumida. `values.append` não é usado porque a detecção de tabela pode se confundir com o painel A–B.
- As fórmulas do painel cobrem até a linha 125. Quando a tabela enche, o agente **insere linhas dentro da faixa** (antes da última linha coberta), para que o Sheets expanda as fórmulas automaticamente. Adicionar linhas no fim deixaria esses gastos fora dos totais.

## Fluxo

```
Telegram ──POST──► Worker
                    ├─ valida secret + ALLOWED_USER_ID
                    ├─ stub.enqueue(update)  (dedupe por update_id)
                    └─ responde 200 na hora
Cron ─────────────► Worker.scheduled() → stub.schedule(tipo)
                         │
                         ▼
                  ChatDO (1 por chat, SQLite)
                    alarm() → executa 1 passo:
                      1. monta request (histórico append-only)
                      2. 1 chamada ao Claude
                      3. tool_use de leitura → executa → agenda próximo passo
                         tool_use de escrita → envia prévia ✅/❌ → pausa
                         end_turn → envia resposta → próxima da fila
                    ✅/❌ ou texto ← resolvem a aprovação pendente
```

O webhook não agenda alarm enquanto um passo está em execução; o próprio passo agenda o próximo ao terminar. Agendar durante a execução travava o processamento por ~76 s no `wrangler dev`.

## Ferramentas

| Ferramenta | Tipo | Observações |
|---|---|---|
| `month_summary`, `list_expenses`, `list_options` | leitura | painel, lançamentos com filtros, dropdowns |
| `list_sheets`, `read_range`, `find_rows` | leitura | outras abas; ocultas só quando pedido |
| `read_file` | leitura | linhas de um CSV recebido, em blocos de 100 |
| `add_expense` | escrita | lote; valida fonte/categoria contra o dropdown, data em C, sufixo, parcelas, avisa duplicados |
| `update_cells` | escrita | em abas mensais só C–G e A2:B5; valida dropdowns |
| `delete_expenses` | escrita | limpa C–G das linhas (não mexe no painel) |
| `add_income` | escrita | primeira linha livre de A2:B5, só quando pedido |
| `append_rows`, `delete_rows` | escrita | apenas abas não mensais |
| `undo_last_write` | escrita | reverte a última escrita registrada |
| `remember`, `forget`, `list_memories` | memória | sem aprovação |

Ferramentas de escrita têm duas fases:
- `prepare` valida e monta a prévia, sem tocar na planilha.
- `apply` roda depois do ✅. Ele confere que as células não mudaram desde a prévia, grava e devolve as operações para desfazer.

Anexos:
- **Fotos e PDFs** entram como blocos de imagem/documento na mensagem do usuário. O limite é ~1,3 MB por arquivo, porque o histórico fica no SQLite do DO, que aceita no máximo 2 MB por valor, e o base64 aumenta o tamanho.
- **CSVs** são lidos pelo código e guardados na tabela `files`. O modelo recebe o id e uma amostra, lê o resto com `read_file` e propõe o lançamento com `add_expense`.
- Foi descartado um `import_csv` com mapeamento de colunas: a categorização por linha precisa do modelo de qualquer forma.

## Regras do Sonnet 5.5 que moldam o código

- Histórico **append-only**: blocos de thinking ficam vinculados ao prefixo da conversa. Editar system prompt, tools ou mensagens anteriores gera 400. Por isso:
  - o system prompt é congelado por conversa (inclui as memórias daquele momento);
  - data/hora vai como prefixo de cada mensagem do usuário;
  - o `content` das respostas é guardado exatamente como a API devolve;
  - a conversa guarda uma assinatura (hash das ferramentas + `PROMPT_VERSION` + prefixo de sandbox); se qualquer um mudar, a próxima mensagem abre uma conversa nova automaticamente. Ao editar o texto do prompt, aumente `PROMPT_VERSION`.
- `tool_choice` forçado (`any`/`tool`) gera 400: usar `auto` + `strict: true`.
- Schemas `strict` não aceitam `minimum`/`maximum`. O zod os gera para `.int()`, então são removidos na conversão; a validação continua no zod.
- Compaction sob demanda (beta `compact-2026-09-04`): depois de uma resposta, se a requisição passou de `COMPACT_AT_TOKENS` (60k), o histórico é resumido. O resumo assinado vira o início do histórico (`conversations.summary_message_id`); as mensagens antigas ficam no banco, mas não são mais enviadas.
- `/cancelar` e recusas fecham o turno com uma mensagem do assistente no histórico, para o modelo não retomar o pedido.
- Histórico sempre válido: toda chamada de ferramenta precisa de resultado na mensagem seguinte. Por isso:
  - a aprovação pendente é gravada antes de a prévia ser enviada;
  - prévias longas são divididas em várias mensagens (o Telegram recusa mais de 4096 caracteres; foi o que quebrou a primeira importação real de CSV);
  - se a prévia falhar, as escritas viram resultados de erro para o modelo;
  - chamadas que ficaram sem resultado (passo interrompido) são fechadas antes da próxima chamada;
  - se a API ainda recusar o histórico, o bot começa uma conversa nova com a última mensagem do usuário;
  - erros inesperados no alarm não são relançados, para o Cloudflare não repetir o mesmo passo em loop.

## Dados no Durable Object

| Tabela | Conteúdo |
|---|---|
| `inbox` | fila e dedupe de updates do Telegram |
| `conversations` / `messages` | histórico append-only, prompt congelado, hash das ferramentas, início após compaction |
| `run_state` | `idle` / `running` / `awaiting_approval`, passo atual, aprovação pendente |
| `memories` | memória de longo prazo |
| `files` | CSVs recebidos |
| `writes` | log de escritas com as operações para desfazer |
| `jobs` | mensagens proativas aguardando o chat ficar livre |
| `usage` | tokens e custo por mês (`/custo`, alerta de 80%) |
| `settings` | chat id, nome do usuário, teto e modelo escolhidos no alerta |

## Arquivos

```
src/
  index.ts              Worker: webhook (secret, allowlist, chat privado) e crons → DO
  chat-do.ts            Durable Object: fila, passos, aprovações, anexos, jobs, custo
  types.ts              Env
  messages.ts           textos fixos do bot (pt-BR)

  commands/             /start /novo /cancelar /memoria /custo /ajuda
  proactive/            lembrete, resumo semanal, fechamento do mês (cron → ação)

  agent/                não conhece Telegram nem DO
    config.ts           modelo, effort, limites, teto, compaction
    types.ts            tipos de mensagem (API beta) e aprovação pendente
    claude.ts           chamadas à API (passo e compaction)
    loop.ts             runStep(): chama o modelo, roda leituras, separa escritas
    prompt.ts           system prompt (congelado por conversa)
    cost.ts             usage → US$

  tools/                cada ferramenta = schema zod + execute (leitura) ou prepare/apply (escrita)
    registry.ts
    sheets/             ferramentas da planilha, uma por arquivo + shared.ts
    files.ts, memory.ts, undo-last-write.ts

  sheets/               acesso ao Google Sheets, sem IA
    auth.ts             JWT da service account
    client.ts           REST + trava de escrita (SHEETS_SANDBOX_PREFIX) + cache da lista de abas
    expenses.ts         layout da aba mensal, leitura, posição de novas linhas, crescimento da tabela
    undo.ts             snapshot e operações de desfazer
    a1.ts               notação A1

  telegram/             api (grammY + auto-retry), format (markdown → HTML), files, keyboards
  db/                   schema Drizzle, migrações, stores
  utils/                csv, dates (America/Sao_Paulo)

test/                   bun test
scripts/
  setup-telegram.ts     webhook + menu de comandos
  dev/                  Telegram falso, CLI de chat, abas TESTE, fixtures
```

Princípios:
- `agent/` recebe dependências injetadas, o que o torna testável e portável para o Agent SDK. As ferramentas viram um MCP com `createSdkMcpServer` sem reescrita.
- `sheets/` concentra as regras da planilha; mudança de layout só mexe lá.
- Acesso ao banco só dentro de `db/stores/`.

## Fases

1. ✅ Fundação: DO + schema, webhook → fila, allowlist, dedupe, `/novo`.
2. ✅ Agente lendo: loop, ferramentas de leitura, chat livre, custo, `/custo`, alerta de 80%.
3. ✅ Escrita: prévias e lotes, texto como correção, duplicados, log + desfazer, parcelas, data em C, crescimento da tabela, renda sob pedido.
4. ✅ Arquivos: fotos, PDFs e CSV.
5. ✅ Memória e contexto: `remember`/`forget`, `/memoria`, compaction.
6. ✅ Proativos: lembrete de sábado, resumo de domingo, fechamento do mês.
7. ✅ Limpeza: código antigo removido, README, `package-lock.json` removido, script de setup do Telegram.

## Validado em desenvolvimento

- Fluxos de ponta a ponta com o agente real, no Telegram falso e nas abas `TESTE`:
  - lançamento que pergunta a fonte que falta;
  - aprovar, recusar e corrigir por texto;
  - duplicado, parcelas com aba faltando, edição, exclusão e desfazer;
  - renda, memória, foto, PDF e CSV;
  - os três crons, compaction, alerta de teto com troca para o Haiku 5.5, e `/cancelar` com prévia pendente.
- Crescimento da tabela: com a aba cheia até a última linha, as linhas novas entraram dentro da faixa e a fórmula foi de `G2:G125` para `G2:G147`, com o total correto.
- Custo: ~US$ 0,004 por chamada ao Sonnet 5.5 (effort medium); uma pergunta usa 1–3 chamadas e um lançamento aprovado, 2–3.
- Bundle: ~400 KiB gzip (limite do plano free: 3 MB).

## Ambientes

| Ambiente | Onde | Telegram | Planilha |
|---|---|---|---|
| `dev` | `wrangler dev` local | falso (`scripts/dev/fake-telegram.ts`) | só abas `TESTE ` (`SHEETS_SANDBOX_PREFIX`) |
| `staging` | Worker `telegram-api-bot-staging` | bot de teste | planilha real, todas as abas; Workers Logs ligado; sem crons |
| produção | Worker `telegram-api-bot` | bot real | planilha real; crons ligados |

No staging, `GET /debug/messages` devolve as últimas mensagens da conversa (só texto e nomes de ferramentas) para depurar o comportamento do agente. A rota só existe quando o secret `DEBUG_TOKEN` está configurado e exige `Authorization: Bearer <token>`; em produção esse secret não existe.

## Pendências conhecidas

- O `/cancelar` só age entre passos: uma resposta que sai numa única chamada termina antes.
- A aba `Gastos 10/2026` real está cheia: o primeiro lançamento do bot vai inserir linhas dentro da faixa das fórmulas (comportamento validado nas abas TESTE).
- Mensagens "rich" do Telegram (Bot API 10.x) e streaming de resposta não foram usados; a resposta sai inteira, em HTML.
