# Beneficiários finais — e-BEF

## Escopo desta entrega

Dossiê por empresa cadastrada e exercício, sem alterar cadastro, apuração ou SERPRO.
O módulo reutiliza a empresa ativa e a autorização de carteira do CFI. O painel de
Vencimentos tem uma aba e-BEF com os dossiês autorizados. Ausência de dossiê não
significa dispensa. A agenda é interna e não envia mensagens.

Implementado: enquadramento assistido, cadeia societária, cálculo racional de
capital, controle documentado, tratamento de SCP, documentos privados, revisão,
registro de entrega e confirmação, histórico imutável e relatório imprimível.
Não transmite à Receita. Não consulta automaticamente situação de entrega. Não
extrai contratos por IA nesta etapa. Nenhum cliente é cadastrado automaticamente.

## Fonte e decisões

Conferência em 15/09/2026: Manual oficial e-BEF v2, abril/2026, páginas 5–7,
12–15, 23–24 e 38; IN RFB 2.119/2022 alterada pela IN 2.290/2025.
https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/cnpj/Manual_eBEF_V02_rev060426.pdf

A versão da regra fica em cada snapshot. É necessária revisão profissional antes
de aprovar. Faturamento de grupo não substitui receita da entidade no ano anterior.

- Participação superior a 25%, não maior ou igual. Precisão de seis casas em cada
  vínculo; aritmética racional sem arredondamento na comparação. Exibição com oito
  casas não é o critério de classificação.
- Capital direto e indireto é somado pelos caminhos; voto indireto e controle são
  avaliados documentalmente, sem presumir que a multiplicação de capital mede poder.
- Na SCP, os sócios ostensivos/participantes não dependem de mínimo percentual.
  O sócio PJ exige seleção fundamentada das pessoas físicas finais. A lista de
  participantes vem do contrato e instrumentos, não apenas do QSA público.
- Capital/voto não quantificado no vínculo direto com SCP pode ficar vazio: não é
  transformado em zero na apresentação. Demais entidades exigem totais completos.
- Eventos têm prazo calculado de 30 dias; anual é 31/12. Prazo interno é separado.
- Não se presume condição de matriz pelo sufixo 0001: deve ser conferida no cadastro.
- Outras naturezas, entidades domiciliadas no exterior, estruturas circulares,
  profundas ou incompletas ficam pendentes. Dispensas especiais fora do escopo
  exigem análise específica; não selecionar uma natureza diferente para contornar.
- Vínculos encerrados no exercício exigem tratamento de seu evento; o sistema
  bloqueia a conclusão anual que silenciosamente descartaria esse histórico.
- As confirmações para estrangeiros exigem evidência e justificativa para exceção;
  o procedimento oficial deve ser reconferido no momento da entrega.

## Persistência e revisão

`ebef_dossies/{fonte_empresaId_ano}` contém a versão atual.
`ebef_dossies/{id}/ebef_versoes/{revision}` preserva cada operação em transação.
O cliente envia a revisão esperada. Em conflito HTTP 409, o formulário mantém as
alterações locais e oferece recarregar. Não há atualização cega.

Estados: rascunho → em_revisao → aprovado → entrega_registrada → concluido.
Dispensa revisada é terminal próprio. Aprovar/concluir exige administrador;
reabrir estado terminal também. Reabrir preserva o histórico e reinicia provas
da entrega atual. Editar rascunho/revisão remove aprovações e confirmações.

Documentos: máximo 80 por dossiê; PDF/PNG/JPEG até 10 MB; Storage privado em
`ebef/{dossieId}/{uuid}`; SHA-256 conferido no download. A API verifica carteira,
empresa e CNPJ. Firestore/Storage permanecem com default-deny para acesso direto.
Não há exclusão nem prazo automático de remoção. Falhas ambíguas de transação não
apagam o objeto: ele pode já estar referenciado por versão confirmada.

## Verificação

- `npm run typecheck` e `npm run lint:strict`.
- `npx jest --runInBand` inclui regras e relatório, além das regressões existentes.
- `npm run test:ebef:api`: servidor HTTP isolado com Firestore/Storage em memória,
  sem credenciais: autorização, conflito concorrente, documentos, histórico,
  dispensa e fluxo completo de entrega e confirmação. Também roda no deploy.
- Interface: iniciar `npx vite --host 127.0.0.1 --port 5179` e executar
  `node scripts/test-ebef-ui.mjs` (Chrome instalado). Fixture sintética sob
  `scripts/fixtures/ebef-preview.html`, fora do bundle de produção.

## Homologação do cliente

O CNPJ informado pelo usuário foi consultado em leitura e não encontrado nas
coleções atuais de empresas. Não foi inserido, alterado ou declarado. Cadastro,
comprovante de matriz, contrato da SCP, lista de participantes, cadeia das PJs e
comprovantes de receita precisam ser obtidos antes da conclusão do atendimento.

Os testes sintéticos demonstram os mecanismos do módulo; não atestam a exatidão de
um dossiê real ainda sem documentos, nem substituem homologação com o cliente.
