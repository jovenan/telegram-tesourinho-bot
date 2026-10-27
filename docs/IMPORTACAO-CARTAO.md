# Plano: importação automática do cartão de crédito (Pluggy)

O bot passa a buscar sozinho as compras do cartão de crédito pelo Meu Pluggy e a propor o lançamento na planilha. Cada compra vem com uma categoria sugerida: pelas regras já aprendidas, quando o estabelecimento é conhecido, ou pelo LLM, quando é novo. Nada é gravado sem a confirmação do usuário. Os demais gastos (Pix, débito, dinheiro, Flash) continuam sendo lançados à mão, pelo chat, como hoje.

Status: **implementado** (todas as fases). Falta ligar em produção: secrets do Pluggy e `PLUGGY_ACCOUNTS` (ver [Configuração](#configuração)).

## Decisões tomadas na implementação

| Tema | Decisão |
|---|---|
| Tabelas | Só `bank_transactions`. O lote aberto fica em `settings` (`bank_batch`); as sugestões vêm das próprias transações (categoria da última compra no mesmo estabelecimento) e das linhas da planilha que o match já leu. `bank_batches` e `merchant_rules` não existem |
| Sufixo | Mantido `- AI GENERATED`. As linhas gravadas pelo import entram no match como as outras, e a contagem por assinatura inclui as transações já importadas |
| Cartão pelo chat | O `add_expense` aplica a regra da fatura quando a fonte é um cartão de `PLUGGY_ACCOUNTS` (parcelas seguem a partir do mês da fatura) |
| Rotas do Pluggy | `POST /auth`, `GET /items/{id}`, `GET /accounts?itemId=`, `GET /bills?accountId=` e `GET /v2/transactions` (cursor). O `GET /transactions` antigo está descontinuado |
| `PENDING` | No cartão, compra da fatura **aberta** vem como `PENDING` e só vira `POSTED` quando a fatura fecha. Como só `POSTED` é importado, o lote chega quando a fatura fecha, com a aba exata vinda da fatura (`/bills`) |
| Lote aberto | Uma prévia nova substitui a anterior (a antiga perde os botões e os itens voltam a ser propostos), mas só quando há novidade: transação nova ou aba que passou a existir |
| Pular | O item volta a `new` e reaparece no próximo lote com novidades (não gera lote sozinho) |
| Match certo | Mesma fonte e valor, e **todas** as linhas candidatas com data próxima (±3 dias ou sem data), com alguma ainda não reivindicada. Duas compras iguais no mesmo dia casam com duas linhas iguais |
| Aprendizado | Além do que é gravado, uma compra que casa com uma linha digitada à mão aprende a categoria daquela linha |
| Avisos | Conexão com problema, aba faltando e fonte fora do dropdown são avisados uma vez (`settings.bank_notices`) |

## Escopo da v1

| Entra | Fica de fora |
|---|---|
| Compras confirmadas na(s) conta(s) de cartão de crédito | Conta corrente, Pix, transferências, débito |
| Detecção do que já está na planilha | Renda automática |
| Sugestão de categoria (regras ou LLM) | Conciliação de saldo e fatura prevista |
| Prévia do lote com confirmação | Webhook do Pluggy |
| Revisão item a item | Lançamento direto, sem prévia (ver [Em aberto](#em-aberto)) |
| | Parcelas (ver [Em aberto](#em-aberto)) |

## Decisões de produto

| Tema | Decisão | Motivo |
|---|---|---|
| O que importar | Só transações da conta de crédito, filtradas no código antes de qualquer chamada ao LLM | É o que o usuário quer automatizar; o resto ele lança à mão |
| Já está na planilha | Casa a transação com linhas existentes (ver [Match](#match-com-a-planilha)); se já está, só marca como vista e não mexe na planilha | O usuário pré-lança coisas (recorrentes, compras feitas pelo chat) |
| Confirmação | **Toda** compra passa pela prévia do lote antes de ser gravada | Mesma regra do resto do bot; começar conservador e só automatizar depois de ver as sugestões acertando |
| Estabelecimento conhecido | A regra aprendida sugere a categoria, sem chamar o LLM | Já foi categorizado antes; não há o que inferir |
| Estabelecimento desconhecido | O LLM sugere a categoria | O nome do banco pode ser opaco (`PAG*JOSEDASILVA`); quando nem o LLM sabe, vem sem sugestão |
| Aprendizado | Gravar uma compra (em lote ou na revisão) grava ou atualiza a regra estabelecimento → categoria | Na próxima vez a sugestão vem da regra |
| Aba de destino | A aba do **mês do vencimento da fatura** em que a compra cai, não a do mês da compra (ver [Aba de destino](#aba-de-destino-mês-da-fatura)) | É no mês seguinte que a compra é paga |
| Data (coluna C) | Data da compra | Mantém o resumo semanal e o match pela data real |
| Descrição | Nome do estabelecimento como vem do banco | Mesma regra de hoje para extratos; o modelo não "limpa" nomes que não conhece |
| Sem novidades | Nenhuma mensagem | Evita ruído diário |
| Convivência | Um lote aberto por vez; o lote só é processado com o agente ocioso | Mesma regra dos jobs proativos |

## Fluxos

### Pipeline por transação

```
transações da conta de crédito
  │  mantém: compras (débito no cartão) com status POSTED
  │  descarta: pagamento de fatura, estorno, PENDING
  │  descarta: ids já registrados em bank_transactions
  ▼
1. Já está na planilha? ──── sim ────► state = in_sheet (não escreve nada)
  │ talvez ──────────────────────────► revisão: "é o mesmo que a linha 34?"
  │ não
  ▼
2. Sugestão de categoria
     regra conhecida ──► 📌 sugestão da regra (sem LLM)
     senão ────────────► 🤖 sugestão do LLM, ou ❓ sem sugestão
  ▼
3. Prévia do lote ──► usuário confirma ──► grava + grava/atualiza a regra
```

### Prévia do lote (uma por sync com novidades)

```
🏦 Cartão Nubank — 13 transações novas
3 já estavam na planilha.

Para lançar (10 · R$ 702,40):
1. 18/10 · IFD*RESTAURANTE XYZ · 📌 Alimentação · R$ 52,90
2. 19/10 · UBER *TRIP · 📌 Transporte · R$ 23,10
3. 20/10 · PAG*JOSEDASILVA · ❓ · R$ 80,00
4. 21/10 · UBER *TRIP · ⚠️ parece a linha 34 · R$ 23,10
5. 22/10 · CINEMARK · 🤖 Lazer · R$ 64,00
…
📌 regra aprendida · 🤖 sugestão do LLM · ❓ sem sugestão · ⚠️ possível duplicado

[✅ Gravar 8 sugeridos] [Revisar 10] [Ignorar lote]
```

| Botão | Efeito |
|---|---|
| Gravar N sugeridos | grava, numa escrita só, os itens com sugestão (📌 e 🤖) e grava as regras; os ❓ e ⚠️ seguem para a revisão |
| Revisar N | revisão item a item de todos os itens do lote |
| Ignorar lote | todos os itens ficam `ignored` |

As escritas entram no log de `writes`, então o "desfaz o último" do agente continua funcionando.

### Revisão item a item

Item com sugestão (📌 ou 🤖):
```
3 de 10 · CINEMARK — R$ 64,00 — 22/10
[✅ Lazer (sugerido)]
[Alimentação] [Mercado] [Casa] [Transporte] …   ← categorias do dropdown, paginadas
[Não lançar] [Pular]
```

Item sem sugestão (❓): igual, sem o botão da sugestão.

Possível duplicado (⚠️):
```
4 de 10 · UBER *TRIP — R$ 23,10 — 21/10
Parece a linha 34: "Uber", 21/10, R$ 23,10
[É o mesmo] [Lançar mesmo assim] [Pular]
```

| Ação | Efeito |
|---|---|
| Categoria (sugerida ou outra) | grava a linha, grava ou atualiza a regra, `state = imported` |
| É o mesmo | `state = in_sheet` |
| Lançar mesmo assim | mostra o item de novo, com os botões de categoria |
| Não lançar | `state = ignored` |
| Pular | continua `new`, volta no próximo lote |

### Outros fluxos

| Situação | Comportamento |
|---|---|
| Aba do mês não existe ou está oculta | Transação fica `waiting_tab`; um aviso por mês; entra no lote quando a aba existir e estiver visível (ver [Segurança](#segurança-pré-requisito)) |
| Conexão caiu ou consentimento expirou | Aviso uma vez: "Reconecte no Meu Pluggy" + `[Já reconectei]` (dispara o sync) |
| Texto enviado com lote aberto | Vai para o agente normalmente; o lote continua aberto (texto como correção do lote fica para depois) |
| `/sync` | Força o sync agora |
| `/banco` | Último sync, contas conectadas, itens pendentes de revisão |

## Aba de destino (mês da fatura)

Compra no cartão vai para a aba do mês em que a fatura **vence**, porque é quando ela é paga. Uma compra de outubro normalmente vai para `Gastos 11/2026`; uma feita depois do fechamento vai para `Gastos 12/2026`.

### Conceitos

| Termo | O que é | C6 |
|---|---|---|
| Vencimento | Dia de pagar a fatura | dia 5 |
| Fechamento | Último dia em que a compra entra na fatura; depois disso vai para a próxima | 7 dias corridos antes do vencimento |
| Melhor dia de compra | Dia seguinte ao fechamento: primeira data da fatura seguinte | 6 dias corridos antes do vencimento |

Os números do C6 (fechamento = vencimento − 7 dias) são uma estimativa que bateu com o "melhor dia" que o app mostrou para a fatura de 05/11/2026 (30/10). Ficam como configuração por cartão, não fixos no código.

### Regra

Para uma compra na data `d`:

1. Vencimento candidato `V` = dia 5 do mês de `d`; fechamento `F = V − 7 dias`.
2. Se `d ≤ F`, a compra é da fatura que vence em `V`.
3. Se não, avança: `V` = dia 5 do mês seguinte, `F = V − 7 dias`, e volta ao passo 2.
4. A aba é a do mês de `V`: `Gastos MM/AAAA`.

| Compra | Fatura | Fechamento | Aba |
|---|---|---|---|
| 03/10/2026 | a de 05/10 fechou em 28/09 → passa para 05/11/2026 | 29/10 | `Gastos 11/2026` |
| 15/10/2026 | 05/11/2026 | 29/10 | `Gastos 11/2026` |
| 29/10/2026 | 05/11/2026 (dia do fechamento) | 29/10 | `Gastos 11/2026` ⚠️ |
| 30/10/2026 | a de 05/11 fechou em 29/10 → passa para 05/12/2026 | 28/11 | `Gastos 12/2026` |
| 28/02/2027 | a de 05/03 fechou em 26/02 → passa para 05/04/2027 | 29/03 | `Gastos 04/2027` |

Fechamento e melhor dia por vencimento (C6):

| Vencimento | Fechamento | Melhor dia de compra |
|---|---|---|
| 05/11/2026 | 29/10/2026 | 30/10/2026 |
| 05/12/2026 | 28/11/2026 | 29/11/2026 |
| 05/01/2027 | 29/12/2026 | 30/12/2026 |
| 05/03/2027 | 26/02/2027 | 27/02/2027 |

### Fonte de verdade

1. **Dado do banco, quando existir.** O Pluggy informa a fatura de cada transação de cartão (`creditCardMetadata.billId`, `billForecastDate`, `billPostDate`). Se vier, a aba é o mês do vencimento dessa fatura, e a regra não é usada.
2. **Regra calculada**, como fallback.
3. **Dia do fechamento** (`d = F`): a compra pode cair em qualquer das duas faturas, dependendo do processamento. Sem dado do banco, vai para a fatura de `V` e aparece com ⚠️ na prévia ("dia do fechamento, confira a fatura"). No match, as duas abas candidatas são procuradas.

### Configuração por cartão

`PLUGGY_ACCOUNTS` passa a guardar, por conta de crédito, a fonte e as datas da fatura:

```json
{ "<accountId>": { "source": "C6", "dueDay": 5, "closingDaysBeforeDue": 7 } }
```

### Consequências

- **Match**: procura a linha na aba da fatura (e nas duas abas, no dia do fechamento), comparando a data da compra na coluna C.
- **Resumo semanal**: hoje lê só as abas dos meses da semana. Compras de cartão da semana ficam na aba do mês seguinte, então o resumo precisa ler também a aba seguinte (filtrando pela data da coluna C). Isso já afeta os lançamentos manuais de cartão que o usuário faz hoje.
- **Aba seguinte ainda não existe** (compra de outubro e `Gastos 11/2026` não criada): cai no fluxo `waiting_tab`.

## Match com a planilha

Descrição não serve como critério principal: o usuário escreve "Netflix", o banco manda "NETFLIX.COM".

| Sinal | Peso |
|---|---|
| Mesma aba: a do mês da fatura (ver [Aba de destino](#aba-de-destino-mês-da-fatura)); só abas `Gastos MM/AAAA` visíveis | obrigatório |
| Mesma fonte de saída (o cartão) | obrigatório |
| Mesmo valor, até o centavo | obrigatório |
| Data da compra a até ±3 dias, ou linha sem data | reforça |
| Descrição parecida | reforça, não é exigida |

- **Um candidato, tudo batendo** → já está na planilha.
- **Valor igual, mas vários candidatos ou data longe** → pergunta na revisão.
- **Nenhum candidato** → segue o pipeline.

Cada linha casa com no máximo uma transação. Duas compras de R$ 23,10 no Uber exigem duas linhas; a segunda transação não pode "reusar" a linha que a primeira já reivindicou. Como as linhas mudam de posição (inserções, exclusões), o controle é por contagem: para cada assinatura (aba, fonte, valor, data aproximada), linhas na planilha menos transações já marcadas `in_sheet` com essa assinatura.

Linhas gravadas pelo próprio import ficam fora do match (identificadas pelo sufixo próprio, ver [Em aberto](#em-aberto)).

Limitação conhecida: assinaturas em dólar e recorrentes que mudaram de preço não batem pelo valor exato e podem virar duplicado. Tolerância de valor fica para depois.

## Categorização

1. **Regras**: chave normalizada do estabelecimento → categoria da última compra conhecida (importada ou casada com uma linha). Resolvido no código, sem LLM.
2. **LLM** só para o que as regras não cobrem: **uma** inferência estruturada por lote, sem ferramentas, sem histórico, sem loop do agente.
   - Entrada: nome cru, valor, MCC (`payeeMCC`), categoria do Pluggy (como dica), opções do dropdown da aba, memórias do usuário.
   - Saída: `{ idx, category: string | null }[]`. `null` → revisão sem sugestão.
   - Modelo barato (`BUDGET_MODEL`, Haiku 5.5). O custo entra no `usage` (`/custo`, alerta de 80%).
3. **Semente sob demanda**: as linhas das abas que o match já leu também ensinam (`UBER *TRIP - AI GENERATED` → Transporte), assim como a linha com que uma compra casou. Linhas manuais com outro nome ("Netflix") não batem com o nome do banco. Só meses visíveis são lidos.

## Arquitetura

### Decisões técnicas

| Tema | Decisão | Motivo |
|---|---|---|
| Fonte | Meu Pluggy | Gratuito, com acesso à API; atualiza as conexões a cada 24h |
| Acesso | Atrás da interface `BankSource`, com tipo próprio | As rotas da API ainda serão confirmadas; o resto não depende delas |
| Gatilho | Cron diário + `/sync` | O Meu Pluggy só atualiza 1×/dia; webhook não compensa agora |
| Execução | Jobs no `ChatDO`, em duas unidades (`bank_fetch`, `bank_process`) | Limite de 50 subrequests por invocação: paginação do Pluggy + Sheets + Claude não cabem juntos |
| Agente | Fora do caminho principal; só a inferência de categoria | Tudo o mais é determinístico e fica melhor em código |
| Aprovação | Estado e teclado próprios do lote, separados do `PendingApproval` | O `PendingApproval` é amarrado ao histórico do agente (`toolUseId`) |
| Escrita | Reaproveita o miolo do `add_expense` (validação de dropdown, posição da linha, crescimento da tabela) e registra em `writes` | Mesmas garantias de hoje, e o "desfaz" do agente continua funcionando |
| Dados | Tabelas novas no SQLite do DO, via Drizzle | Mesmo padrão do resto |

### Visão geral

```
Cron diário ─► Worker.scheduled() ─► ChatDO.schedule('bank_fetch')
/sync ───────────────────────────────┘
                                          │
         alarm (uma unidade por invocação)│
                                          ▼
  [bank_fetch]   BankSource.transactions(desde o último sync − margem)
                 filtra conta de crédito, POSTED, compras
                 grava novas em bank_transactions (dedup pelo id)
                 agenda bank_process
                                          ▼
  [bank_process] só com runState idle e nenhum lote aberto
                 match com a planilha → sugestão (regras; LLM só p/ desconhecidos)
                 envia a prévia do lote (nada é gravado ainda)
                                          ▼
  [callbacks]    bank:<ação>:<token>[:idx]
                 gravar sugeridos · revisar · categoria · é o mesmo · não lançar · pular · ignorar lote
                 cada gravação: 1 escrita, logada em writes
```

A janela do fetch volta alguns dias além do último sync (margem), para pegar transações que passaram de `PENDING` a `POSTED` depois. O dedup pelo id evita repetição.

### Interface da fonte

```ts
// src/bank/source.ts
interface BankSource {
  transactions(since: Date): Promise<BankTransaction[]>
}

interface BankTransaction {
  id: string
  accountId: string
  date: string
  purchaseDate?: string
  description: string
  amount: number
  status: 'pending' | 'posted'
  kind: 'purchase' | 'bill_payment' | 'refund'
  installment?: { number: number; total: number }
  mcc?: string
  providerCategory?: string
}
```

- `PluggySource`: mapeia as respostas da API para esse tipo. Escrito quando as rotas forem confirmadas.
- `FakeBankSource`: lê fixtures sintéticas, para o dev e os testes.

### Módulos novos

```
src/
  pluggy/                 sem IA, sem DO (como sheets/)
    types.ts              respostas da API
    client.ts             auth, item, contas, faturas, transações (cursor)
    source.ts             PluggySource: resposta da API → BankTransaction

  bank/                   não conhece Telegram nem DO (como agent/)
    source.ts             BankSource, BankTransaction, FakeBankSource
    config.ts             PLUGGY_ACCOUNTS → cartões (fonte, vencimento, fechamento)
    text.ts               normalização e data da planilha
    filter.ts             o que entra: crédito, POSTED, compra
    bill.ts               aba de destino: fatura do banco ou regra vencimento/fechamento
    match.ts              "já está na planilha?" (assinaturas e contagem)
    rules.ts              chave normalizada do estabelecimento e sugestão pela última categoria conhecida
    categorize.ts         a inferência única do LLM
    process.ts            pipeline: match → sugestões (regras, LLM) → lote para a prévia
    messages.ts           resumo, revisão e teclados (categorias paginadas)

  db/stores/
    bank-transactions.ts
```

### Tabelas novas

| Tabela | Conteúdo |
|---|---|
| `bank_transactions` | `id` (do Pluggy, PK), conta, data, descrição, valor, fatura, parcela, MCC, `state`: `new` · `review` · `in_sheet` · `imported` · `ignored` · `waiting_tab`, aba, fonte, chave do estabelecimento, categoria, sugestão, possível duplicado, posição no lote |

Mudanças em tabelas existentes: `jobs.kind` ganha `maintenance`, `bank_fetch` e `bank_process`; `settings.key` ganha `bank_last_sync`, `bank_batch` (lote aberto), `bank_accounts` (contas vistas no último sync) e `bank_notices` (avisos já enviados).

### Configuração

Secrets (`wrangler secret put`, e `.dev.vars` no dev). Nada disso vai para o git:

| Secret | Conteúdo |
|---|---|
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | credenciais da aplicação no Meu Pluggy |
| `PLUGGY_ITEM_IDS` | ids das conexões, separados por vírgula (no Meu Pluggy, `GET /v2/items` responde 403) |
| `PLUGGY_ACCOUNTS` | JSON por conta de crédito: fonte de saída do dropdown, dia do vencimento e dias entre fechamento e vencimento (ver [Configuração por cartão](#configuração-por-cartão)) |

Cron: `0 11 * * *` (8h em São Paulo) dispara a limpeza e o `bank_fetch`. Produção passa a usar 4 dos 5 do plano free.

No dev, `BANK_SOURCE = "fake"` (em `[env.dev.vars]`) usa `scripts/dev/fixtures/bank-transactions.json`, e sem `PLUGGY_ACCOUNTS` o cartão é `fake-c6` → fonte `C6`.

### Mudanças no código atual

| Arquivo | Mudança |
|---|---|
| `src/chat-do.ts` | +1 ramo no `alarm()` para as unidades bank; roteamento de `bank:*` em `handleCallback`. A lógica fica num `BankImport` separado para não inchar o DO |
| `src/tools/sheets/add-expense.ts` | Extrair o miolo de `prepare`/`apply` para uma função reutilizável, com sufixo parametrizável e sem expansão de parcelas |
| `src/db/schema.ts` | tabelas novas + migração (`bun run db:generate`) |
| `src/index.ts`, `src/proactive/index.ts`, `wrangler.toml` | cron diário mapeado para `bank_fetch` |
| `src/commands/` | `/sync`, `/banco` |
| `src/messages.ts` | textos no tom do Grana |
| `src/telegram/keyboards.ts` | teclados do resumo e da revisão |

Não mudam: `agent/`, o histórico append-only, o `PendingApproval` e as ferramentas atuais.

### Limites a respeitar

- **50 subrequests por invocação**: fetch e processamento em unidades separadas; lotes grandes podem precisar de mais de uma unidade de processamento.
- **`callback_data` até 64 bytes**: botões levam o token do lote e índices curtos, nunca o id do Pluggy (UUID, 36 bytes).
- **Prévias e resumos acima de 4096 caracteres**: usar o `splitMessage` que já existe.

## Segurança (pré-requisito)

Mudanças no bot atual, independentes do Pluggy, feitas **antes** da importação. Reduzem o que o agente (e o import) alcança na planilha e fecham uma falha no webhook.

### Acesso só às abas mensais visíveis

Regra única para leitura e escrita, de todas as ferramentas e do import:

- A aba precisa se chamar exatamente `Gastos MM/AAAA` (no dev, com o prefixo: `TESTE Gastos MM/AAAA`). Cópias e abas renomeadas deixam de valer, mesmo com o layout de gastos.
- A aba precisa estar **visível**. Ocultar um mês corta o acesso a ele, para leitura e escrita.
- O layout (cabeçalhos em C1:G1) continua sendo conferido antes de escrever, como garantia de estrutura, mas não dá acesso por si só.

| Onde | Mudança |
|---|---|
| `append_rows`, `delete_rows` | **removidas** (só existiam para abas não mensais) |
| `list_sheets` | lista só as abas `Gastos MM/AAAA` visíveis |
| `read_range`, `find_rows`, `update_cells` | recusam qualquer outra aba |
| `add_expense` e demais ferramentas de gastos | perdem o parâmetro `sheet` (lançar numa cópia); vale só o mês |
| `Spreadsheet` / `SheetsClient` | trava central, no estilo da `SHEETS_SANDBOX_PREFIX`: leitura e escrita fora da regra são bloqueadas antes do request, mesmo que uma ferramenta esqueça de checar |
| Prompt | sem menções a outras abas, cópias ou abas ocultas; aumentar o `PROMPT_VERSION` |
| Testes | `test/sheets-guard.test.ts` cobre nome fora do padrão, aba oculta e aba com layout certo mas nome errado |
| `docs/ARQUITETURA.md` | atualizar a seção Planilha (hoje diz que a aba é de gastos pelo layout e que ocultas são acessíveis quando pedidas) |

Consequências aceitas:

- Comparar com um mês oculto ("compara com setembro") não funciona enquanto ele estiver oculto.
- O fechamento do dia 1º não consegue ler o mês anterior se ele já tiver sido ocultado; o bot avisa em vez de resumir.
- Parcelas para meses futuros ocultos são tratadas como aba inexistente (o aviso que já existe).

A trava é no código: a service account continua editora da planilha inteira no Google. Por isso a chave segue só nos secrets, e a planilha deve ser a única coisa compartilhada com a service account.

### Webhook: recusar quando o secret faltar

Hoje a checagem do header `X-Telegram-Bot-Api-Secret-Token` é pulada quando `TELEGRAM_WEBHOOK_SECRET` não está configurado (`src/index.ts:17`). Passa a ser *fail closed*, como já é com o `ALLOWED_USER_ID`:

- secret ausente → recusa todo update e registra o erro no log;
- secret errado → recusa (como hoje).

O dev já passa `TELEGRAM_WEBHOOK_SECRET:dev-secret` no `dev:worker`, então não muda nada lá.

### Operacional (fora do código)

- Compartilhar com a service account só esta planilha.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, chave do Google e credenciais do Pluggy só nos secrets da Cloudflare (e no `.dev.vars`, fora do git).
- Telegram do dono com verificação em duas etapas ligada e sessões revisadas: quem toma a conta conversa com o bot e aprova escritas.

## Manutenção do banco (tarefa separada)

Independente do Pluggy. Hoje nada é apagado do SQLite do Durable Object, e fotos e PDFs ficam no histórico em base64 (até ~1,3 MB cada). Duas mudanças:

### Fotos e PDFs pela Files API

O histórico enviado ao modelo é append-only: trocar ou apagar a imagem de uma mensagem antiga muda o prefixo e pode fazer a API recusar a conversa (400). Por isso a imagem não pode simplesmente ser removida depois. Em vez de guardar os bytes, o arquivo vai para a Files API da Anthropic e a mensagem guarda só a referência.

| Hoje | Depois |
|---|---|
| foto/PDF baixado do Telegram e guardado em `messages` como base64 | baixado do Telegram, enviado com `client.files.upload` (1 subrequest a mais) |
| bloco `{ type: "image", source: { type: "base64", data } }` | bloco `{ type: "image" \| "document", source: { type: "file", file_id } }` |
| limite de ~1,3 MB por arquivo (`MAX_INLINE_FILE_BYTES`), por causa do teto de 2 MB por valor no SQLite | limite do Telegram para bots (20 MB) |
| histórico cresce com cada foto | `messages` guarda só o `file_id` |

- Tabela nova `uploads` (`fileId`, `conversationId`, `createdAt`, `deletedAt`), para saber o que apagar na Anthropic.
- Os arquivos ficam guardados na Anthropic até serem apagados (ver limpeza abaixo).
- Mensagens antigas com base64 não são reescritas (append-only); somem quando a conversa delas for limpa.
- O recomeço de conversa após erro (`restartConversation`) reaproveita os blocos da última mensagem; com `file_id` continua funcionando, desde que o arquivo não tenha sido apagado.

### Limpeza diária

Um job `maintenance`, disparado pelo cron diário (o mesmo que depois dispara o `bank_fetch`; produção passa a usar 4 dos 5 crons do plano free). Roda em unidades pequenas, como os outros jobs, para caber em 50 subrequests (os deletes na Anthropic são em lotes).

| O quê | Regra |
|---|---|
| `inbox` | apaga updates processados há mais de 7 dias |
| `files` (CSVs) | apaga os recebidos há mais de 30 dias |
| `messages` da conversa atual | apaga as anteriores ao resumo da compactação (`summary_message_id`): já não são enviadas ao modelo |
| `conversations` + `messages` antigas | apaga conversas que não são a atual e têm mais de 90 dias |
| `uploads` | apaga na Anthropic (`client.files.delete`) os arquivos de conversas que não são a atual ou de mensagens anteriores ao resumo; marca `deletedAt`. Nunca apaga arquivo da conversa em andamento |
| `writes` | apaga entradas com mais de 90 dias |
| `jobs` | apaga os processados há mais de 30 dias |
| `usage`, `settings`, `memories`, `run_state` | mantém (pequenas) |
| `bank_transactions` | mantém: é o que impede uma compra antiga de voltar |

## Desenvolvimento e testes

- **Dev**: `FakeBankSource` com fixtures sintéticas em `scripts/dev/fixtures/`. A escrita continua limitada às abas `TESTE ` (`SHEETS_SANDBOX_PREFIX`).
- **Fixtures**: só dados inventados. Nenhuma resposta real do Pluggy vai para o repositório.
- **`bun test`** para a lógica pura: filtro, match (incluindo a contagem por assinatura), normalização da chave do estabelecimento, montagem do lote.
- **`dev:chat`**: `--cron` para disparar o sync e `--click bank:…` para os botões, como já funciona com os outros fluxos.

## Fases

| Fase | Entrega | Depende da API? |
|---|---|---|
| S. Segurança | abas só `Gastos MM/AAAA` visíveis, remoção de `append_rows`/`delete_rows`, trava no `Spreadsheet`, webhook *fail closed* | não |
| M. Manutenção | fotos e PDFs pela Files API, tabela `uploads`, job `maintenance` no cron diário | não |
| 0. Lógica pura | `bank/filter`, `match`, `rules`, `process` + testes com fixtures sintéticas | não |
| 1. Pipeline no dev | tabelas, `FakeBankSource`, jobs `bank_fetch`/`bank_process`, `/sync`, prévia do lote e "Gravar sugeridos" nas abas `TESTE ` | não |
| 2. Interação | revisão item a item, duplicados, gravação das regras | não |
| 3. Semente e status | regras a partir do histórico da planilha, `/banco` | não |
| 4. Pluggy real | confirmar rotas, sonda só de leitura, `PluggySource`, cron diário | **sim** |
| 5. Robustez | conexão expirada, `waiting_tab`, ajustes vindos do uso real | sim |

## Em aberto

| Tema | Pergunta | Proposta atual |
|---|---|---|
| Parcelas | O import vira a fonte de verdade das parcelas do cartão? O agente para de pré-criar `(2/n)`, `(3/n)` para compras no cartão? | Discutir depois; fora da v1 |
| Parcelas futuras | A documentação diz que parcelas futuras vêm como `PENDING` (não são importadas); falta ver na conexão real | Rodar `scripts/dev/pluggy-probe.ts` |
| Vencimento em fim de semana ou feriado | O fechamento muda quando o vencimento é adiado para o dia útil seguinte? | Verificar com faturas reais; até lá, dias corridos |
| Data no Pluggy | `date` é a data de lançamento; `purchaseDate` só vem em parceladas. Hoje: `purchaseDate` quando vier (exceto parcelas 2+), senão `date` | Conferir na sonda se a diferença incomoda |
| Fatura aberta | Importar também as `PENDING` da fatura aberta, para o lote sair antes do fechamento? | Não na v1: o valor pode mudar e o id pode trocar ao confirmar |
| Estorno | Ignorar ou avisar ("estorno de R$ 80 da Loja X, apagar a linha?") | Ignorar na v1 |
| `PENDING` → `POSTED` | O id da transação muda quando ela é confirmada? | Verificar na sonda; se mudar, o dedup precisa de outra chave |
| Lançamento direto | Itens com regra conhecida entram sem prévia, com um "Desfazer" na mensagem de resumo? | Fora por enquanto; reavaliar depois de ver as sugestões das regras acertando no uso real |
| Lembrete de sábado | Com o cartão automático, o lembrete passa a cobrar só o que o banco não vê e os itens pendentes? | Ajustar depois da v1 |
| Regras | Gerenciar o de-para pelo chat (`/regras` para listar e remover) | Opcional, depois da v1 |

## Estrutura final do projeto

Como o repositório ficou ao fim de todas as fases. Legenda: `+` novo · `~` alterado · `−` removido · sem marca: não muda. Entre colchetes, a fase em que a mudança entra.

```
.env.example                    ~ PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS, PLUGGY_ACCOUNTS  [4]
.gitignore
README.md                       ~ importação do cartão, /sync, /banco, secrets novos  [4]
bun.lock
drizzle.config.ts
package.json
tsconfig.json
worker-configuration.d.ts       ~ regenerado (tipos do Env)  [1]
wrangler.toml                   ~ cron diário (maintenance, depois bank_fetch); env.dev com BANK_SOURCE = "fake"  [M, 1]

docs/
  ARQUITETURA.md                ~ abas só "Gastos MM/AAAA" visíveis, webhook fail closed, Files API, limpeza, módulo bank  [S, M, 1]
  DESENVOLVIMENTO.md            ~ fonte falsa, /sync e botões bank:* no dev:chat  [1]
  IMPORTACAO-CARTAO.md          + este plano

src/
  index.ts                      ~ webhook fail closed; cron diário → maintenance e bank_fetch  [S, M, 4]
  chat-do.ts                    ~ fotos/PDFs via Files API; job maintenance; ramo bank no alarm(); callbacks bank:* → BankImport  [M, 1, 2]
  bank-import.ts                + BankImport: liga bank/ ao DO (jobs, lote aberto, Telegram)  [1, 2]
  maintenance.ts                + limpeza diária: retenções e delete dos arquivos na Anthropic  [M]
  types.ts                      ~ Env: PLUGGY_*, BANK_SOURCE  [1, 4]
  messages.ts                   ~ /sync e /banco na ajuda; limite de arquivo  [M, 1]

  agent/                        não conhece Telegram nem DO
    claude.ts                   ~ upload e delete na Files API  [M]
    config.ts
    cost.ts
    history.ts
    loop.ts
    prompt.ts                   ~ só abas mensais visíveis; PROMPT_VERSION++  [S]
    types.ts

  bank/                         + não conhece Telegram nem DO (como agent/)
    source.ts                   + BankSource, BankTransaction, FakeBankSource  [0]
    config.ts                   + PLUGGY_ACCOUNTS → cartões  [0]
    text.ts                     + normalização e data da planilha  [0]
    filter.ts                   + o que entra: conta de crédito, POSTED, compra  [0]
    bill.ts                     + aba de destino: fatura do banco ou regra vencimento/fechamento  [0]
    match.ts                    + "já está na planilha?" (assinaturas e contagem)  [0]
    rules.ts                    + chave do estabelecimento e sugestão pela última categoria conhecida  [0]
    categorize.ts               + a inferência única do LLM para os desconhecidos  [0]
    process.ts                  + pipeline: filtro → aba → match → sugestões → lote  [0]
    messages.ts                 + textos do lote, revisão, avisos e /sync  [2]

  pluggy/                       + sem IA, sem DO (como sheets/)
    types.ts                    + respostas da API  [4]
    client.ts                   + auth, contas, transações paginadas, status da conexão  [4]
    source.ts                   + PluggySource: resposta da API → BankTransaction  [4]

  commands/
    index.ts                    ~ /sync, /banco  [1, 3]

  proactive/
    index.ts                    ~ cron diário (maintenance, bank_fetch); resumo semanal lê também a aba do mês seguinte  [M, 1, 4]

  sheets/                       sem IA
    a1.ts
    auth.ts
    client.ts                   ~ trava central: leitura e escrita só em "Gastos MM/AAAA" visíveis  [S]
    expenses.ts                 ~ aba de gastos pelo nome (e layout para escrever); ocultas fora  [S]
    undo.ts

  telegram/
    api.ts
    files.ts                    ~ limite de tamanho passa a ser o do Telegram (20 MB)  [M]
    format.ts
    keyboards.ts                ~ teclados do lote e da revisão (categorias paginadas)  [2]

  tools/
    index.ts                    ~ sem append_rows e delete_rows  [S]
    registry.ts                 ~ cartões no ToolContext; erro de aba inacessível  [S, 1]
    files.ts
    memory.ts
    undo-last-write.ts
    sheets/
      add-expense.ts            ~ sem o parâmetro sheet; regra da fatura para cartões; usa expense-plan.ts  [S, 1]
      add-income.ts
      append-rows.ts            − só existia para abas não mensais  [S]
      delete-expenses.ts        ~ só o mês (sem sheet)  [S]
      delete-rows.ts            − só existia para abas não mensais  [S]
      expense-plan.ts           + escrita do add_expense (sufixo, crescimento da tabela, desfazer), usada também pelo import  [1]
      find-rows.ts              ~ só abas mensais visíveis  [S]
      list-expenses.ts          ~ só o mês (sem sheet)  [S]
      list-options.ts           ~ só o mês (sem sheet)  [S]
      list-sheets.ts            ~ lista só abas mensais visíveis  [S]
      month-summary.ts          ~ só o mês (sem sheet)  [S]
      month.ts                  ~ sem o campo sheet  [S]
      read-range.ts             ~ só abas mensais visíveis  [S]
      shared.ts
      update-cells.ts           ~ só abas mensais visíveis  [S]

  db/
    index.ts
    schema.ts                   ~ uploads [M]; bank_transactions; jobs.kind e settings.key novos  [M, 1]
    migrations/
      0000_init.sql
      0001_agent_features.sql
      0002_maintenance.sql      + gerada pelo drizzle-kit  [M]
      0003_bank_import.sql      + gerada pelo drizzle-kit  [1]
      migrations.js             ~ regenerado  [1]
      meta/
        _journal.json           ~ regenerado  [1]
        0000_snapshot.json
        0001_snapshot.json
        0002_snapshot.json      + gerado  [M]
        0003_snapshot.json      + gerado  [1]
    stores/
      bank-transactions.ts      + [1]
      uploads.ts                + [M]
      conversations.ts          ~ apagar mensagens antes do resumo e conversas antigas  [M]
      files.ts                  ~ apagar CSVs antigos  [M]
      inbox.ts                  ~ apagar updates processados  [M]
      jobs.ts                   ~ apagar jobs processados  [M]
      memories.ts
      run-state.ts
      settings.ts
      usage.ts
      writes.ts                 ~ apagar entradas antigas  [M]

  utils/
    csv.ts
    dates.ts

test/
  a1.test.ts
  bank-bill.test.ts             + vencimento, fechamento, dia do fechamento, fevereiro, virada de ano  [0]
  bank-filter.test.ts           + [0]
  bank-match.test.ts            + inclusive duas compras iguais no mesmo dia  [0]
  bank-process.test.ts          + [0]
  bank-rules.test.ts            + [0]
  cost.test.ts
  csv.test.ts
  dates.test.ts
  expense-tab.test.ts           ~ aba pelo nome "Gastos MM/AAAA"  [S]
  expenses.test.ts
  format.test.ts
  history.test.ts
  maintenance.test.ts           + retenções; nunca apaga arquivo da conversa atual  [M]
  pluggy.test.ts                + resposta do Pluggy → BankTransaction  [4]
  proactive.test.ts             ~ resumo semanal com a aba do mês seguinte  [4]
  registry.test.ts
  sheets-guard.test.ts          ~ leitura e escrita fora das abas mensais visíveis bloqueadas  [S]
  writes.test.ts                ~ botões do import cabem em 64 bytes  [2]

scripts/
  setup-telegram.ts             ~ /sync e /banco no menu de comandos  [1]
  dev/
    chat.ts
    env.ts
    fake-telegram.ts
    make-fixtures.ts
    seed-test-sheets.ts
    setup-test-sheets.ts
    pluggy-probe.ts             + sonda só de leitura da conexão real  [4]
    fixtures/
      cupom.jpg
      cupom.pdf
      extrato-nubank.csv
      bank-transactions.json    + transações sintéticas para a FakeBankSource  [0]
```

Resumo: 27 arquivos novos (sem contar migrações geradas), 2 removidos, cerca de 40 alterados. Em `agent/` mudam só o prompt e o cliente (Files API); o loop, o histórico e o `PendingApproval` ficam como estão.

## Referências

- [Pluggy: Transactions](https://docs.pluggy.ai/docs/transactions): `creditCardMetadata` (`installmentNumber`, `totalInstallments`, `totalAmount`, `purchaseDate`, `billId`, `payeeMCC`), status `PENDING`/`POSTED`
- [Pluggy: List transactions](https://docs.pluggy.ai/reference/transactions-list)
- [Meu Pluggy: guia de acesso via API](https://meu.pluggy.ai/api-guide): atualização a cada 24h, `GET /v2/items` restrito
