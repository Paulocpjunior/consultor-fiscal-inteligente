# Plano de migração E-Fiscal → CFI: ordem das ondas

> Paulo, 05/08: *"essa ordem quem traz é você"*. Este documento é a ordem de
> execução decidida a partir da varredura REAL de 07/2026 (aba 🚦 Migração),
> não de estimativa. Atualizar quando um piloto/onda fechar.

## Os números que decidiram (07/2026, 198 empresas com movimento)

| sinal | qtd | consequência na ordem |
|---|---|---|
| **NFS-e fora da ponte .FML** | **157 empresas** / 4.024 docs | o maior grupo, e o de MENOR risco — vira a onda 1 |
| Compra interestadual (DIFAL aquisição) | 36 | já entregue no CFI; onda 3 |
| Indústria/IPI (bloco K) | 3 | nicho — onda final |
| Venda a não contribuinte (E310) | **2** | nicho — **não descartar o bloco**, mas não bloqueia ninguém mais |
| ST em saída (E220) | **0** | nenhum substituto na carteira; o E220 (04/08) fica de reserva |
| CT-e | 1 | irrelevante — a hipótese de "crédito de frete perdido" caiu |

## ⚠ CORREÇÃO 05/08 — a ordem abaixo estava ERRADA e foi refeita

Paulo: *"essas empresas são prestadoras de serviços, não têm Inscrição
Estadual"*. **Sem IE a empresa não é contribuinte de ICMS e NÃO entrega EFD
ICMS/IPI.** Não existe SPED Fiscal delas — nem no CFI, nem no E-Fiscal.
Fazer piloto ali seria comparar dois arquivos que não existem.

Isso derruba a "onda 1 = serviço puro" que eu tinha proposto e corrige,
pela SEGUNDA vez, a leitura dos 4.024 documentos fora da ponte: para
empresa sem IE, aquelas NFS-e **nunca deveriam** ir à escrituração de ICMS
do E-Fiscal. Não é lacuna — é o desenho certo. Elas alimentam EFD
Contribuições e ISS, que são outro trilho.

**O escopo real da migração do SPED Fiscal é só quem tem IE.** A 🚦 passou a
medir isso (`contribuinteIcms`, resumo `contribuintesIcms` ×
`semInscricaoEstadual`) e prestadora de serviço saiu das candidatas a piloto.

A ordem correta está em "## A ordem (revisada)" mais abaixo.

## [HISTÓRICO — descartado] Por que a ordem começava pelo SERVIÇO

As empresas de serviço puro (advogados, clínicas, imobiliárias, igrejas —
`emissão própria 0`, faturamento todo em NFS-e) têm três propriedades que
nenhuma outra tem:

1. **Não passam por nenhuma pendência aberta**: sem ICMS, ficam fora de
   E220, E310, bloco K, CIAP e DIFAL. As validações do PVA que ainda faltam
   não as tocam.
2. **O CFI já tem 100% do dado delas** — a NFS-e é capturada; o E-Fiscal não
   recebe nada (a ponte .FML só leva NF-e/NFC-e).
3. Na prática **já estão migradas e ninguém percebeu**. Migrar é oficializar.

## A ordem

### [DESCARTADO] Piloto 1 — serviço puro · CLINICA MEDICA MANTOAN (37 docs)
**Não vale**: sem IE, não entrega EFD ICMS/IPI. Mantido aqui só pra não se
repetir o raciocínio.

Escolhida por: serviço puro, volume conferível linha a linha numa tarde, e é
caso já conhecido do time e do app (Presumido trimestral, validado em 03/08).
Substituível por qualquer outra de 30-40 docs do mesmo perfil (RHEIN
SCHIRATO 35, MONICA MOROMIZATO 31, CASA DA CRIANCA 29).

### Piloto 2 — ICMS · **COMERCIO DE PECAS PARA CAMINHOES PARANA** (77 docs)
Escolhida por cobrir os sinais mais comuns num tamanho ainda conferível:
emissão própria (30), ST em entrada (4) e NFS-e (5). **É neste piloto que as
4 validações do PVA se resolvem** (E220/ST, IPI, CIAP, C197) com caso real.
Alternativas: KROYA (95) ou DISTRIBUIDORA DE BANANAS (255, mais pesada).

### Onda 1 — serviço puro (o grosso dos 157)
Depois do piloto 1 fechar. Grupos de 20-30. Risco baixo, ganho imediato:
tira do limbo o faturamento que o E-Fiscal não vê.

### Onda 2 — comércio sem DIFAL
Os que têm emissão própria e nenhum sinal de atenção.

### Onda 3 — com DIFAL de aquisição (36)
Já entregue no CFI; entra depois que a onda 2 provar o trilho de ICMS.

### Onda 4 — nichos, por último
3 indústria/IPI (bloco K), 2 E310, 1 CIAP (EXPERTE). Constrói-se o bloco
**quando a onda chegar**, não antes.

## Decisões técnicas que esta ordem já resolve

- **NÃO construir "NFS-e na ponte .FML"**. Seria trabalho que morre com a
  transição, e as empresas afetadas são justamente as que migram PRIMEIRO.
- **E310 e bloco K ficam para a onda 4** — 2 e 3 empresas não param as
  outras 193.
- **Regra da onda**: no primeiro mês o cliente roda nos DOIS (gera no CFI,
  gera no E-Fiscal, compara). Só a partir do segundo é só CFI. O E-Fiscal
  segue vivo, então o gabarito está do lado — é conferência, não fé.
- **Cliente sem aptidão de saída comprovada não entra na onda de ICMS** (vai
  para a fila de configuração autXML/cofre). Não vale para a onda 1: empresa
  de serviço não emite NF-e de saída.


---

# A ordem (revisada 05/08, depois da correção da IE)

O escopo do SPED Fiscal é **só contribuinte de ICMS**. A 🚦 agora mostra
quantos são; o restante da carteira (prestadoras) não entra nesta migração —
o que elas entregam é EFD Contribuições e ISS, trilho separado que o CFI já
cobre e o E-Fiscal não alimenta.

### Piloto 1 — contribuinte com ICMS SIMPLES · **COMÉRCIO DE PEÇAS PARANÁ** (77 docs)
Emissão própria (30), ST em entrada (4) — tamanho conferível linha a linha.
Sem DIFAL, sem indústria: valida o núcleo (blocos 0/C/E) sem ruído.

### Piloto 2 — contribuinte com DIFAL · **DISTRIBUIDORA DE BANANAS ELS** (255 docs)
Emissão própria (106) + 20 compras interestaduais. É neste que o DIFAL de
aquisição e o C197 se provam. Alternativa menor: KROYA (95, 2 interestaduais).

### Onda 1 — contribuintes sem sinal de atenção
Os que têm IE e nenhum bloqueio na 🚦.

### Onda 2 — contribuintes com DIFAL de aquisição (36)

### Onda 3 — nichos: 3 indústria/IPI (bloco K), 2 E310, 1 CIAP (EXPERTE)
Constrói-se o bloco quando a onda chegar.

### Fora desta migração — prestadoras sem IE
Não têm EFD ICMS/IPI. O que precisa ser conferido nelas é outra coisa:
**onde a equipe apura PIS/COFINS e ISS hoje**, já que o E-Fiscal não recebe
as NFS-e. Isso é uma pergunta em aberto, não uma onda.

### Regra da onda (inalterada)
1º mês roda nos DOIS e compara; o E-Fiscal segue vivo e serve de gabarito.
Cliente sem aptidão de saída comprovada não entra na onda.
