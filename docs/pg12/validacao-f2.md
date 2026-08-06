# PG12 (E-Fiscal) — validação dos arquivos da fase F2

> ## ⚫ F2 SAIU DO PLANO em 05/08/2026
> Paulo: *"não me preocuparia com o passado, o e-fiscal continua ativo e
> servirá para consultas."* O E-Fiscal **não será desligado** — vira o sistema
> de consulta do histórico, e a migração passou a ser só da OPERAÇÃO CORRENTE.
>
> **A volumetria CHEGOU em 06/08** e está analisada abaixo — ela CONFIRMA a
> decisão, não a reabre. Não iniciar extração/transformação de dados do PG12.
>
> O que este documento ainda serve: registrar que o **DDL foi validado** (o
> `pad_modelo` prova que os 1.735 schemas são o mesmo molde) e onde a
> estrutura está guardada, caso a decisão mude um dia.

Paulo extraiu e mandou em **05/08/2026** ("antes de começarmos o dia, para que
você valide"). REGRA mantida: só ESTRUTURA transita — nenhum dado fiscal de
cliente veio nos arquivos, e é assim que continua (extração de dados vai
direto pra bucket GCS privado do projeto, nunca pelo chat).

## Veredito: os 3 pedidos entregues ✅ (volumetria chegou em 06/08)

| Arquivo | Situação |
|---|---|
| `efiscal_ddl.sql` (pg_dump --schema-only) | ✅ **PERFEITO** — os 4 schemas pedidos: `e0299` (618 tabelas), `pad_modelo` (618 — confirma que é o MOLDE: todo e#### tem as mesmas 618), `gen` (273) e `gen_modelo` (273). Guardado aqui em `efiscal_ddl.zip` |
| `\dt gen.*` (`efiscal_tabelas_gen.txt`) | ✅ 270 tabelas — guardado aqui |
| `efiscal_volumetria_e0299.csv` (volumetria) | ✅ **RECEBIDA 06/08** — 618 tabelas, com o SQL de `pg_class` (não depende de ANALYZE). Guardada aqui; análise abaixo |
| `efiscal_public_ddl.sql` + `efiscal_tabelas_public.txt` (bônus) | ✅ `public` tem UMA tabela (`mergedb`) — irrelevante pra migração |
| `schemas_efiscal.csv` | ✅ já conhecido (84 GB, 1.735 schemas e####) |

## O que a volumetria mostrou (e0299, 06/08/2026)

**12,70 GB · 23,0 milhões de linhas · 618 tabelas — mas só 118 COM DADOS.**
As outras 500 estão vazias: o `pad_modelo` é um molde grande para um uso
pequeno, e "618 tabelas por empresa" nunca foi o tamanho do problema.

Oito tabelas somam **99,4%** do volume, e as seis maiores são todas de SAÍDA:

| tabela | tamanho | linhas | acumulado |
|---|---|---|---|
| lcsreg54 | 5.575 MB | 6.948.161 | 42,9% |
| lcsreg542 | 2.270 MB | 5.898.652 | 60,3% |
| nfsaida | 2.191 MB | 1.809.641 | 77,2% |
| nfsresuman | 1.212 MB | 3.037.961 | 86,5% |
| lcsaida | 1.184 MB | 3.056.670 | 95,6% |
| nfsreg54 | 333 MB | 1.804.716 | 98,1% |

**Saída 1.809.641 notas × entrada 22.275** — razão de 81 para 1. É varejo
de alto volume, e o peso do banco é a escrituração ITEM A ITEM dessas
saídas.

### O que isso confirma

A decisão de 05/08 (F2 fora do plano) fica mais sólida, não menos: o que
pesa é histórico de detalhe de saída — exatamente o que o E-Fiscal vai
continuar servindo como consulta. Migrar isso seria mover 12,7 GB de
detalhe que ninguém abre no dia a dia.

E uma medida de escala que muda a leitura de risco: **e0299 sozinha é 12,7
de 89,5 GB — 14% da base inteira em UM cliente**. A base é concentrada;
não são 1.735 clientes pesados.

### O que isso revela (e vale para as ondas)

- **Cadastro é barato**: `cli_for` 315 participantes e `pro_ser` 16.632
  itens. Se um dia for preciso migrar cadastro de um cliente, o volume não
  é obstáculo — o obstáculo sempre foi o histórico.
- **`inventar` com 5.900 linhas**: este cliente TEM inventário lançado no
  E-Fiscal. Nosso bloco H ainda é 🟡 (gera H005/H010 com qtd/valor a
  preencher). Cliente com inventário só migra depois que essa lacuna
  fechar — ou o inventário vem dele, à mão.
- **`apuracao_difal` com 2.403 linhas**: DIFAL apurado lá, e o CFI já
  cobre (fases 1 e 2). Paridade esperada no piloto.
- **`nfdipam` 0 · `ciapbens` 0 · `reg55` 0 · `ecftotalizador` 0**: sem
  DIPAM, sem CIAP, sem ECF/SAT — coerente com as respostas do F0 humano
  (CIAP só a EXPERTE; SAT virou NFC-e).
- **`nf_iss` 0 e `nf_iss56` 669**: ISS existe em volume pequeno neste
  cliente, na tabela nova.

## SQL da volumetria (usado — não depende de ANALYZE)

```sql
SELECT c.relname                                   AS tabela,
       pg_total_relation_size(c.oid)               AS bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho,
       c.reltuples::bigint                         AS linhas_estimadas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'e0299' AND c.relkind = 'r'
ORDER BY 2 DESC;
```

Exportar TODAS as linhas (618) em CSV — se a ferramenta paginar, aumentar o
limite ou rodar via `psql -c "..." --csv > e0299_volumetria.csv`.

## Mapa inicial das tabelas de MOVIMENTO (o que a extração vai querer)

Reconhecidas no DDL do `e0299` (valem pra todo schema e####):

- **Entradas**: `nfentrad` / `nfentrad2` (+ `nfentevento*`, `nfentimport`)
- **Saídas**: `nfsaida` / `nfsaida2` (+ `nfsaievento*`)
- **Serviços/ISS**: `nf_iss`, `nf_iss56` (+ `_chaves`, `infocomp`, `procref`)
- **Livros ICMS por item**: `lcereg54*` (entrada), `lcsreg54*` (saída),
  `nfereg54`/`nfsreg54`, `reg55`, `reg71`
- **CIAP**: `ciapconfig`, `ciapitemen/pb/sa`
- **DIPAM**: `nfdipam` (cruzar com o 🌾 do CFI)
- **Cupom/ECF**: `ecftotalizador`, `ecfengrev`, `cbdetiss(tomados)`
- **Config por empresa**: `confcfop`, `confgerefd(contrib)`, `configsimples`…

Sufixo `2` (`nfentrad2`, `nfsaida2`) sugere tabela-extensão do cabeçalho —
confirmar na volumetria + amostra de colunas quando a F2 começar de fato.

## Próximos passos da F2 (aguardam ordem do Paulo)

1. Paulo reenviar a volumetria do `e0299` com o SQL acima.
2. Definir o alvo da 1ª extração-piloto (sugestão: os 2 pilotos da F1).
3. Extração SEMPRE: PG12 → dump por schema → bucket GCS privado
   (`consultorfiscalapp`), usuário read-only `cfi_leitura`, PG12 nunca
   exposto à internet.
4. Confronto de identidade: `e{Cod.Cliente}` ↔ CNPJ — a carga do Cod.Cliente
   foi feita em 05/08 (390 empresas ativas) e é a amarração oficial.
