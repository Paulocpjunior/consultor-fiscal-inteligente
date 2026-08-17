# Privacidade e proteção de dados (LGPD) — a página pública e o que a sustenta

<!-- guia-id: privacidade-lgpd · guia-revisao: 2026-08-17 -->
<!-- Mexeu aqui? mexa no par em public/privacidade.html e suba a revisão nos DOIS. -->

> Fonte dupla: este arquivo e `public/privacidade.html` DEVEM ser atualizados
> juntos (`__tests__/guiaParDuplo.test.ts` barra o build se divergirem).

Nasceu do pedido do Paulo (17/08): *"devemos atender a lei de proteção de
dados LGPD, evidenciar de forma enfática que estamos em acordo com a lei,
sugiro isso no rodapé"*.

## 🚨 A decisão de projeto que manda aqui

**Selo não é conformidade.** Escrever "estamos em conformidade com a LGPD" no
rodapé é fácil, e é a coisa mais arriscada que o app poderia fazer: vira uma
**afirmação ao titular**. Se amanhã alguém pedir os dados dele e a resposta for
"não temos como fazer isso", o selo deixa de ser marketing e passa a ser
**prova de informação enganosa** na mão de quem reclamar.

É a régua do **farol honesto** aplicada a outro domínio: verde tem que
significar alguma coisa.

Por isso a ordem foi **mecanismo primeiro, frase depois**. O rodapé leva a uma
página que diz o que o app FAZ — e o que ainda não faz.

## O que o app faz de verdade (é isso que o rodapé afirma)

| Direito | Mecanismo |
|---|---|
| **Acesso** (art. 18, II) | relatório com cadastro, etiquetas **com a finalidade de cada uma**, consentimentos, conteúdo das mensagens e envios de guia |
| **Eliminação** (art. 18, VI) | plano **antes** de apagar: o que sai, o que fica e **por quê** |
| **Revogação** (art. 18, IX) | revogar vale na hora e o envio daquela natureza passa a ser recusado |
| **Registro** (art. 37) | toda solicitação gravada em `lgpd_solicitacoes` com autor e data |

Duas decisões de desenho que valem a pena lembrar:

- **O registro entra ANTES do apagamento.** Se algo falhar no meio, sobra a
  prova de que o pedido existiu. O contrário deixaria dado sumido sem rastro de
  quem mandou sumir.
- **O relatório entrega o CONTEÚDO das mensagens, não a contagem.** "Temos 40
  mensagens suas" não é acesso — é avisar que se tem algo.

## O que a eliminação NÃO alcança

A própria lei (art. 16) preserva o necessário para obrigação legal e exercício
regular de direitos. Aqui isso é:

- **documentos fiscais** — guarda obrigatória pela legislação tributária;
- **comprovantes de envio de guia** — é a prova que defende o escritório se o
  cliente disser que nunca recebeu;
- **trilha de auditoria** — apagá-la destruiria justamente a prova de que os
  dados foram bem tratados.

O sistema mostra esses itens **nomeados** antes de qualquer exclusão. Prometer
"apagamos tudo" e guardar seria pior do que não prometer.

## A seção de pendências é deliberada

A página tem uma seção **"o que ainda está em andamento"** — encarregado (DPO)
nomeado e publicado, registro completo das operações, revisão dos contratos com
operadores. Isso não é fraqueza do texto: um selo verde que esconde pendência
não protege ninguém, e diante da ANPD **informação enganosa é pior que
informação incompleta**.

Conforme cada item for concluído, ele **sai da seção de pendências e entra na de
mecanismos, com a data** — e a revisão da página sobe nos dois arquivos.

## O que depende do Paulo (não é código)

1. **Nomear e publicar o encarregado (DPO)** — art. 41. Enquanto não houver, o
   canal de contato da página é o ponto de contato.
2. **Conferir o e-mail do canal do titular** que está publicado na página.
3. **Revisar contratos com fornecedores** que atuam como operadores.

Enquanto (1) estiver aberto, **não trocar a seção de pendências por um selo
fechado** — seria exatamente o que este desenho evita.
