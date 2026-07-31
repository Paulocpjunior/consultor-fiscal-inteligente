# Guia do Colaborador — DIPAM e FUNRURAL (compra de produtor rural)

> Fonte do guia servido em `/guia-dipam-produtor-rural.html` (botão 📗 na aba
> 🌾 DIPAM / Produtor rural). **Atualizar os DOIS juntos** — mesmo padrão do
> guia da saída mod 55.

**Onde no sistema:** Central de Documentos Fiscais → XMLs (Entrada/Saída) →
**🌾 DIPAM / Produtor rural**.

## Por que essa aba existe

Compra de produtor rural PF gera **duas obrigações** da mesma nota, antes
digitadas na mão no SAGE:

| | DIPAM 1.1 | FUNRURAL (sub-rogação) |
|---|---|---|
| O que é | total mensal por **município paulista** de origem (rateio do ICMS/IPM) | empresa recolhe a previdência **no lugar do produtor** |
| Vale para | só produtor de **SP** | produtor PF de **qualquer estado** |
| Onde declara | ficha DIPAM B da GIA **e** Registro 1400 da EFD | guia previdenciária (DCTFWeb) |
| Se errar | multa RICMS/SP art. 527; SEFAZ cruza com as NF-e desde 2025 | recolhimento errado |

MG → só FUNRURAL. SP → as duas. A aba lê as notas capturadas e entrega tudo
pronto; o trabalho do colaborador é **confirmar fornecedor** e **conferir
pendência**.

## 1. Marcar o CLIENTE (uma vez)

Dados Fiscais → seção 🌾:

- **Adquire de produtor rural** → obrigação cobrada todo mês, mesmo mês sem nota;
- **É produtor rural PF** → entrega DIPAM-A anual, não lança 1.1;
- **Cooperativa** → código 1.3;
- **Não calcular FUNRURAL** → só com orientação do admin + motivo na observação.

A marcação não substitui as notas: divergência entre marcação e notas aparece
na aba.

## 2. Rodar o mês

1. Escolher a competência → **"🔎 Quem tem DIPAM neste mês"**;
2. A lista inclui clientes **não marcados** (⚠) — abrir cada um;
3. No painel: DIPAM por município, **📋 copiar Registro 1400**, FUNRURAL nota a
   nota (3 valores separados, centavo desprezado), pendências com ação.

**Regra de ouro:** painel **vermelho** = total INCOMPLETO (nota fora da conta).
Não lançar na GIA antes de resolver.

## 3. Confirmar fornecedor (pendência mais comum)

Automático: emitente com **CPF** ou IE paulista começando com **"P"** (CNPJ não
descaracteriza — CAT 45/2008). CNPJ sem IE de produtor vendendo agro → pendência
"confirmar no CADESP":

| CADESP diz | Botão | Efeito |
|---|---|---|
| Produtor Rural (Pessoa Física) | **Produtor Rural (PF)** | entra em tudo, todas as notas, todos os clientes |
| PF agricultura familiar | **PF · segurado especial (1,5%)** | DIPAM igual; FUNRURAL fica em 1,5% |
| Outra coisa | **Pessoa Jurídica** | sai da conta pra sempre |

Lançar PJ no 1.1 = SEFAZ desconsidera o lançamento inteiro. Só admin grava.

## 4. Alíquotas (o sistema sabe; o colaborador confere)

| Situação | Total |
|---|---|
| Venda até 31/03/2026 | 1,50% |
| Venda ≥ 01/04/2026 (LC 224/2025) | 1,63% (1,32 + 0,11 + 0,20) |
| Segurado especial | 1,50% sempre |
| Optante pela folha / PJ | sem sub-rogação |

O cálculo é conferido contra o FUNRURAL declarado no rodapé da própria nota;
diferença real vira pendência ⚠ divergente.

## 5. Fora da conta (de propósito)

Depósito/armazenagem/retorno simbólico/consignação; CFOP 1131; canceladas;
compra de PJ comum (nem vira pendência). Devolução **deduz**; mês negativo não
vai ao arquivo e compensa no seguinte.

## Continua manual

Transmitir a GIA; lançar no SAGE (usar os valores da tela); emitir a guia do
FUNRURAL.

## Fluxo de 10 segundos

```
Cliente comprou de produtor rural?
├─ VERMELHO?                 → CADESP → botão certo → recarrega
├─ ÂMBAR?                    → ler pendências
├─ VERDE?                    → copiar 1400 + lançar GIA + FUNRURAL
├─ "não marcado no cadastro" → Dados Fiscais → 🌾
└─ marcado e mês vazio       → conferir a CAPTURA primeiro
```

## Rotina sugerida

| Frequência | Ação |
|---|---|
| Início do mês | rodar a varredura da competência anterior; confirmar fornecedores |
| Antes da GIA/EFD | painel verde → Registro 1400 → conferir ficha DIPAM B |
| Cliente novo rural | marcar 🌾 no primeiro dia |
| Divergência FUNRURAL | segurado especial? alíquota errada do emitente? → escalar |
