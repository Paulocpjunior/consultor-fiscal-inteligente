# Guia do Colaborador — Captura de SAÍDA (NF-e mod 55)

<!-- guia-id: saida-mod55 · guia-revisao: 2026-08-12 -->
<!-- Mexeu aqui? mexa no par em public/ e suba a revisão nos DOIS. -->

**Onde:** Central de Documentos Fiscais → aba **📥 Importar** → **Manual & Cofre (saída 55)**

---

## Por que essa aba existe (leia primeiro)

A SEFAZ **nunca entrega ao emissor a nota que ele mesmo emitiu** (Rejeição 641).
Ou seja: as notas de **venda/saída** dos nossos clientes não chegam sozinhas pelo
certificado deles — precisam de uma "ligação" que o cliente faz **uma vez**, ou
de importação nossa. Esta aba concentra tudo isso. Era o papel da SIEG; agora é nosso.

---

## 1. 🔗 As DUAS ligações do cliente (automáticas para sempre)

> **Quando usar:** em TODO cliente que emite NF-e mod 55. É a primeira coisa a
> resolver — qualquer uma das duas serve, não precisa das duas.

### Opção A — Cofre de e-mail
- **O que é:** o sistema emissor do cliente manda uma cópia do XML para
  **xml@spassessoriacontabil.com.br** a cada emissão.
- **Como configurar:** botão **"📋 Copiar comunicado ao cliente"** (no card
  Saída mod 55 do Diagnóstico, ou no Checklist do Cofre) → enviar ao cliente.
  O e-mail dele deve mandar o **XML** (não só o PDF/DANFE).
- **Vale para:** notas novas **e antigas** (o emissor pode reenviar o histórico
  em ZIP para o mesmo e-mail — o sistema não duplica nada).

### Opção B — autXML
- **O que é:** o cliente inclui o CNPJ **44.388.152/0001-89** no campo
  "autorizados a obter XML" (tag autXML) do sistema emissor dele.
- **Como configurar:** no CADASTRO do emissor (para valer em toda nota nova) —
  **não** é o Bloco 0100 do SPED. Cada CNPJ que emite (matriz e filiais)
  precisa da própria configuração.
- **Vale para:** somente notas emitidas **depois** da configuração (a
  autorização entra dentro da nota na hora da emissão — não é retroativa).
- **Como conferir se valeu:** ver item 4 (Confirmação) e item 5 (Prova).

---

## 2. 📦 Importação Manual (ZIP)

> **Quando usar:** para trazer o **histórico** (notas emitidas antes das
> ligações acima) ou cobrir um período específico que faltou.
> **Por quê:** autXML não é retroativo e o cofre só recebe o que o emissor
> mandar — o ZIP fecha o passado.

**Como:** peça ao cliente (ou exporte da SIEG enquanto ativa) o ZIP com os
XMLs → arraste na seção de Importação ZIP da aba. O sistema deduplica sozinho:
pode subir o mesmo arquivo duas vezes sem medo.

---

## 3. 🏢 Colheita de Saída via autXML (botões)

> **Quando usar:** normalmente NUNCA precisa — roda sozinha 3×/dia. Os botões
> são para dois momentos:
> - **"Colher agora (incremental)"** — o cliente acabou de configurar o autXML
>   e você quer ver as notas entrando sem esperar o próximo ciclo.
> - **"Backfill (recomeçar do início)"** — repuxa os últimos ~90 dias do
>   fluxo. Use quando suspeitar que algo se perdeu. No máximo 1×/dia.

**Por quê:** é o robô que baixa da SEFAZ as notas autorizadas via autXML e
entrega cada uma à empresa dona.

---

## 4. 📋 Cobertura de Saída — "quem ainda não está ligado"

> **Quando usar:** toda semana (rotina), e sempre que um cliente disser
> "já configurei".
> **Por quê:** é a lista de trabalho da migração — mostra quem ainda não tem
> NENHUMA saída chegando sozinha.

**Como:**
1. Botão **"Gerar relatório"**.
2. **🎯 PRIORITÁRIAS** (vermelho): emitem mod 55 e paramos de capturar —
   atacar primeiro, de cima para baixo (ordenado por volume). Botão de **CSV**
   para distribuir a lista.
3. "Sem evidência" (recolhido): provavelmente nem emitem mod 55 — baixa prioridade.
4. **"Cliente disse que ligou? Confirme aqui"**: digite o nome/CNPJ. O sistema
   PROVA por qual trilho a nota está chegando (cofre/autXML, com data) — ou
   diz exatamente o que cobrar do cliente. Importação manual **não** confirma
   ligação nenhuma.

---

## 5. 🔢 Prova de Saída por numeração — a EXATIDÃO

> **Quando usar:** semanalmente, e antes de qualquer conversa de "está
> faltando nota". Também chega **todo dia no e-mail das 9h** — se houver nota
> faltando, o próprio ASSUNTO do e-mail avisa.
> **Por quê:** NF-e é numerada em sequência POR SÉRIE e POR ESTABELECIMENTO.
> Se temos a 760, 761 e 763, a **762 está faltando — com número**. É prova
> matemática, sem depender de SIEG nem do cliente.

**Como ler o resultado (botão "Rodar prova"):**

| O que aparece | O que significa | O que fazer |
|---|---|---|
| ✅ **Exatas** | Sequência contínua — tudo que o cliente emitiu chegou | Nada 🎉 |
| 🔴 **Com buraco** + números | Notas específicas NÃO chegaram (lista o nº exato) | Pedir ao cliente exatamente essas notas (ZIP/e-mail) e conferir a ligação |
| 🟡 **Histórico não coberto** (faixa gigante) | A captura começou no meio da numeração — falta o passado, não é falha da ligação | Resolver com ZIP/backfill (item 2) — **não** cobrar o cliente |
| Aviso de **inutilizada** | Buraco pode ser numeração inutilizada legalmente (não circula na SEFAZ) | Confirmar com o cliente ANTES de cobrar |

**Limite honesto:** a prova enxerga até a **maior nota capturada** de cada
série. Nota emitida depois dela ainda não é detectável — é o papel dos trilhos
(cofre/autXML) trazê-la; quando a próxima chegar, a sequência fecha o cerco.

---

## Rotina sugerida

| Frequência | Ação |
|---|---|
| **Diária (9h)** | Ler o e-mail de resumo — se o assunto tiver "🔢 N nota(s) FALTANDO", abrir a Prova e agir nos números listados |
| **Semanal** | Gerar a Cobertura de Saída → atacar as 🎯 prioritárias (comunicado cofre/autXML) |
| **Ao cliente dizer "configurei"** | Buscar o nome na Confirmação → validar o trilho com data |
| **Cliente novo com histórico** | ZIP do histórico (item 2) + ligação (item 1) no mesmo dia |

## Fluxo de decisão em 10 segundos

```
Falta nota de saída de um cliente?
├─ Nunca chegou NADA dele sozinho?  → Cobertura de Saída → cobrar ligação (cofre OU autXML)
├─ Chegava e parou?                 → Confirmação (item 4) → ver qual trilho quebrou
├─ Faltam NÚMEROS específicos?      → Prova (item 5) → pedir exatamente essas notas
└─ Falta o PASSADO inteiro?         → ZIP / backfill (item 2) — não é culpa do cliente
```

---
*Dúvidas técnicas: falar com o Paulo (admin). Este guia vive em
`docs/guia-colaborador-saida-mod55.md` e é atualizado junto com a ferramenta.*

*Versão pública para a equipe: `/guia-saida-mod55.html` no próprio app
(fonte em `public/guia-saida-mod55.html` — atualizar as DUAS ao mudar o guia).*
