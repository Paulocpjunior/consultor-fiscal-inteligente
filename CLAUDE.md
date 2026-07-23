# CFI — Consultor Fiscal Inteligente (SP Assessoria Contábil)

Memória de trabalho para sessões do Claude. Atualize ao assumir compromissos
com o Paulo (admin/dono) — é daqui que a próxima sessão retoma.

## Regras permanentes de operação

- **Deploy e merge automáticos**: todo trabalho vai em PR → squash-merge →
  acompanhar o deploy (GitHub Actions `deploy-app.yml`) até ficar VERDE, sem
  perguntar. Branch de trabalho designada pela sessão; nunca commitar direto
  na main.
- **Validação por RESULTADO, não por status**: "deploy verde" e "cron rodou"
  não significam "capturou nota". Sempre verificar o efeito real (docs
  capturados, painel Diagnóstico com farol honesto). Lição de 22/07/2026:
  NFS-e SP ficou semanas "verde" com 0 sucessos/121 falhas.
- Mensagens de erro para o usuário: em português, com a AÇÃO prática (padrão
  interpretarCstat). Módulos de lógica: puros e testados (jest), rotas = I/O.
- CNPJ escritório: 44.388.152/0001-89. Projeto GCP `consultorfiscalapp`
  (us-west1). Scheduler: `scripts/setup-cloud-schedulers.sh` (idempotente;
  o Paulo roda no Mac dele — clone em `~/consultor-fiscal-inteligente`).

## Fila de features acordadas (com requisitos)

1. **Retificação DCTFWeb/MIT pelo CFI** (aprovada 23/07/2026 — próxima feature):
   - Botão "Retificar com os valores do app" na Conferência DCTFWeb × Apuração,
     para quando a apuração JÁ FOI transmitida e os valores do app mudaram
     (caso CLINICA MANTOAN 06/2026: aplicações financeiras lançadas depois).
   - Mecânica: reencerramento MIT (ENCAPURACAO314) com débitos ajustados;
     a DCTFWeb retificadora é gerada automaticamente pela Receita.
   - **REQUISITO INEGOCIÁVEL: somente usuários ADMIN podem retificar**
     (`req.user.role === 'admin'` no backend + esconder botão no front para
     não-admin). Preview obrigatório do antes → depois antes de transmitir,
     mesmo padrão do preenchimento atual.
2. **Consolidação da Central de XMLs: 16 → 8 abas** (proposta apresentada
   22/07, aguardando "bora" do Paulo). Sem mudança de lógica; PRs incrementais;
   padrão de sub-abas do DctfwebHub. Mapa completo da auditoria nos PRs de
   22/07.

## Contexto vivo (jul/2026)

- Migração SIEG → CFI em andamento. Saída mod 55 = cofre de e-mail
  (`xml@spassessoriacontabil.com.br`); SEFAZ não entrega saída ao emissor
  (Rejeição 641). Checklist de migração do cofre lista os "falta migrar".
- NFS-e SP = trilho PORTAL CSV (WS legado aposentado — erro 1102; job
  `nfsesp-cron-noturno` pausado). NFS-e Nacional ADN: elegibilidade cruzada
  com município (SP capital fora); restavam 4 empresas para preencher codMun.
- Ferramenta "Conferência CFI × SIEG por chaves" valida migração e importa
  faltantes (cert da própria empresa, pacing anti-656).
- cStat 656: nunca insistir na mesma raiz; padrão round-robin + cooldown +
  circuit-breaker (manifesto) e cooldown 3h no "⟲ 90d" (resetNSU).
