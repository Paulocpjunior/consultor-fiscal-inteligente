# PG12 (E-Fiscal) — validação dos arquivos da fase F2

> ## ⚫ F2 SAIU DO PLANO em 05/08/2026
> Paulo: *"não me preocuparia com o passado, o e-fiscal continua ativo e
> servirá para consultas."* O E-Fiscal **não será desligado** — vira o sistema
> de consulta do histórico, e a migração passou a ser só da OPERAÇÃO CORRENTE.
>
> **NÃO pedir a volumetria do `e0299` ao Paulo** (o SQL abaixo ficou obsoleto)
> e não iniciar extração/transformação de dados do PG12.
>
> O que este documento ainda serve: registrar que o **DDL foi validado** (o
> `pad_modelo` prova que os 1.735 schemas são o mesmo molde) e onde a
> estrutura está guardada, caso a decisão mude um dia.

Paulo extraiu e mandou em **05/08/2026** ("antes de começarmos o dia, para que
você valide"). REGRA mantida: só ESTRUTURA transita — nenhum dado fiscal de
cliente veio nos arquivos, e é assim que continua (extração de dados vai
direto pra bucket GCS privado do projeto, nunca pelo chat).

## Veredito: 2 dos 3 pedidos ✅ · 1 precisa ser refeito ❌

| Arquivo | Situação |
|---|---|
| `efiscal_ddl.sql` (pg_dump --schema-only) | ✅ **PERFEITO** — os 4 schemas pedidos: `e0299` (618 tabelas), `pad_modelo` (618 — confirma que é o MOLDE: todo e#### tem as mesmas 618), `gen` (273) e `gen_modelo` (273). Guardado aqui em `efiscal_ddl.zip` |
| `\dt gen.*` (`efiscal_tabelas_gen.txt`) | ✅ 270 tabelas — guardado aqui |
| `efiscal_tabelas_e0299.csv` (volumetria) | ❌ **REFAZER** — veio com só 80 das 618 tabelas e contagens ~zero para um schema de 13 GB. Causa provável: `pg_stat_user_tables` sem ANALYZE (estatística nunca coletada) e/ou export limitado à página visível da ferramenta. SQL correto abaixo |
| `efiscal_public_ddl.sql` + `efiscal_tabelas_public.txt` (bônus) | ✅ `public` tem UMA tabela (`mergedb`) — irrelevante pra migração |
| `schemas_efiscal.csv` | ✅ já conhecido (84 GB, 1.735 schemas e####) |

## SQL da volumetria a refazer (não depende de ANALYZE)

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
