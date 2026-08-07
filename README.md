# Dashboard de Tráfego — Dr. Vinícius

Dash estática (GitHub Pages) do funil de tráfego pago do Dr. Vinícius.

- **Fonte 1 — Meta Graph API** (direto, nível anúncio, por dia): mídia + **conversas (CTWA)** + Programar (Schedule/LP) + Leads. Conta `act_1189400572310429`.
- **Fonte 3 — planilha das secretárias** (gviz CSV): faturamento total (consultas + cirurgias).
- Resultado-headline = **conversas por WhatsApp**. Programar e Leads = secundários.
- Imposto ×1,1385 sobre todo gasto. CTR sempre de link.

## Rodar local
```
# precisa do META_ACCESS_TOKEN (env ou .env local — .env é gitignored)
./build.ps1 -Mode all      # gera data.js
python -m http.server 8791 # abre http://localhost:8791
```

## Deploy
- `build.ps1` roda no GitHub Actions (`.github/workflows/build.yml`), lê a Meta via secret `META_ACCESS_TOKEN` e publica no Pages.
- Rebuild automático a cada 3h via cron-job.org (POST no `workflow_dispatch`).

## Roadmap
- **Fase 2:** planilha de leads do formulário/quiz (telefone + `ad_id` + plano) → camada de lead qualificado por anúncio.
- **Fase 3:** cruzar telefone (leads ↔ faturamento das secretárias) → ROAS só do tráfego.

Somente leitura. Publica só agregados (sem PII).
