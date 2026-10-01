# Holding Money

Sistema Central de Inteligência Comercial, Monetização e Execução — VPA Projetos & Negócios.

Aplicação completa (front-end + back-end) construída a partir do blueprint *Holding Money*: central de comando, banco comercial, agentes especialistas, diagnósticos públicos, governança com aprovação humana, rotina diária e relatório semanal.

## Requisitos

- Node.js 22.13 ou superior (recomendado 24 LTS)
- Nenhum banco externo e nada para compilar: os dados ficam no SQLite embutido do próprio Node, num único arquivo

## Como rodar

```bash
npm install
cp .env.example .env   # opcional
npm start
```

Abra `http://localhost:3000`. No primeiro acesso:

1. Clique em **Criar conta**. Cada conta é uma empresa, com os próprios dados; quem cria é o fundador (administrador) e pode adicionar a equipe depois.
2. Responda o questionário **Conte sobre sua empresa**, em 7 etapas curtas (Empresa, Oferta, Cliente, Posicionamento, Crescimento, Operação e Outras linhas de negócio). As perguntas se adaptam ao momento da empresa: quem ainda não vende não responde sobre faturamento ou canal principal.
3. A IA propõe a **estrutura comercial inicial** (negócios, produtos, ofertas, scripts, plano de ação e riscos). Você desmarca o que não quiser e confirma. Também dá para pular e cadastrar tudo do zero.

O sistema nasce vazio de propósito: só vêm prontos a doutrina do Holding Money e os 12 agentes especialistas. Nenhum dado fictício.

> Se você já rodou uma versão anterior, apague a pasta `data` antes de iniciar: o formato de armazenamento mudou.

### Várias empresas no mesmo sistema

Cada conta tem o próprio arquivo de banco em `data/contas/<id>.db`, então os dados de uma empresa nunca se misturam com os de outra. O arquivo `data/sistema.db` guarda só as contas e os logins. Para backup, copie a pasta `data` inteira.

Para desenvolvimento com recarga automática: `npm run dev`.

## Módulos

| Área | O que faz |
|---|---|
| Painel | Ação de dinheiro do dia, receita x meta, lucro, pipeline, indicador soberano (receita por ação executada), dinheiro parado, follow-up, funil e gráfico financeiro |
| Agentes | Chat com o agente principal e os 12 especialistas, usando o prompt mestre e um retrato atualizado do banco comercial |
| Leads | Kanban com arrastar e soltar, WhatsApp em um clique, marcação de contato |
| Propostas | Fluxo com aprovação obrigatória antes do envio |
| Banco comercial | Negócios, produtos, ofertas, conteúdos, campanhas (CPL/CAC/ROI automáticos), scripts, lançamentos, tarefas (prioridade por impacto × urgência × esforço, com concluir e cancelar) e riscos (com impacto) |
| Rotina | Checklist diário das 8 perguntas e relatório semanal das 10 seções (gerado automaticamente) |
| Governança | Aprovações em quadro por tipo (proposta final, contrato, preço, campanha, decisão financeira e posicionamento público). Mudanças de preço e investimento feitas por operadores viram pedidos de aprovação |

## Criação com IA

- **Estrutura inicial:** em Contexto da empresa > Gerar estrutura com IA (pode ser refeito a qualquer momento).
- **Sugerir com IA:** botão em Negócios, Produtos, Ofertas, Conteúdos, Campanhas, Scripts, Tarefas e Riscos. Você escreve o que precisa, revisa as sugestões e escolhe quais criar.
- A IA só propõe. Nada é salvo sem confirmação, ela não inventa clientes, provas ou resultados, e preços só entram se você informou preços no contexto. Leads, propostas e lançamentos financeiros nunca são gerados pela IA: são fatos.
- Com a IA desligada, a estrutura inicial é montada só com o que foi escrito no contexto, e as sugestões por área ficam indisponíveis.

## Perfis de acesso

- **Fundador (admin):** tudo, incluindo aprovar/recusar, identidade, integrações e usuários.
- **Operador:** opera o banco comercial; ações sensíveis geram pedido de aprovação.

## Formulários públicos

Modelos do blueprint (Style-Code, VPA e Código Interno). Ficam **desligados** até você ativar em Formulários e integrações. Sem login, prontos para colocar na bio ou enviar por WhatsApp:

- `/d/<código-da-conta>/acc` — Diagnóstico ACC (Style-Code)
- `/d/<código-da-conta>/vpa` — Diagnóstico de Performance em Vendas (VPA)
- `/d/<código-da-conta>/codigo-interno` — Teste do Código Interno

Os links completos, já com o código da conta, aparecem em Configurações (engrenagem no rodapé do menu) > Formulários e conexões.

Cada resposta cria ou atualiza o lead, classifica o perfil, define temperatura, produto indicado e próximo contato.

## Webhook de leads (Make, n8n, Tally, Typeform…)

```
POST /api/webhooks/<código-da-conta>/lead
Header: x-webhook-token: <token>
Body JSON: { "nome": "...", "contato": "...", "empresa": "...", "origem": "...", "dor": "...", "temperatura": "Quente", "observacoes": "..." }
```

O endereço e a chave de cada conta aparecem em **Formulários e conexões**.

## Inteligência artificial

Quem instala o sistema define o provedor e a chave no `.env` do servidor (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`; opcionalmente `AI_PROVIDER` e `AI_MODEL`). Com Gemini, o modelo padrão é `gemini-3.5-flash`. O usuário final nunca vê provedor, modelo ou chave.

Dentro do app, o fundador só decide **usar ou não a IA** (Sistema > Inteligência artificial, ou pelo botão "Ativar IA" que aparece onde ela faria diferença). A IA vem ligada por padrão.

Se a instalação não tiver chave configurada, o app esconde todos os recursos de IA e funciona no modo básico: o Core responde com alertas e prioridades calculados a partir dos dados, e a estrutura inicial usa só o que foi escrito no contexto.

## Publicação (deploy)

- Qualquer servidor com Node 22.13+ (VPS, Railway, Render, Fly.io). Use `npm start`.
- Configure `JWT_SECRET` e `COOKIE_SECURE=true` com HTTPS.
- Aponte `DATA_DIR` para um volume persistente e faça backup do arquivo `holding-money.db`.
- Todos os recursos visuais (Bootstrap, ícones, fontes Montserrat e Inter, Chart.js) são servidos localmente, sem CDN.

## Estrutura

```
server/   index.js (servidor), schema.js (entidades), db.js (banco e dados iniciais),
          auth.js, crud.js (CRUD + governança), insights.js (painel, alertas, rotina, score),
          diagnostics.js (formulários públicos e webhook), core.js (agente e IA)
public/   index.html + js/ (SPA), diagnostico.html, css/app.css
```

---
Aviso: o sistema organiza estratégia, operação e monetização. Não substitui orientação jurídica, contábil, tributária ou financeira especializada. O Teste do Código Interno não é avaliação clínica.
