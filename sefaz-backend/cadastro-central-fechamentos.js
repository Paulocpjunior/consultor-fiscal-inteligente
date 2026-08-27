// ============================================================================
// sefaz-backend/cadastro-central-fechamentos.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// 🔒 FASE 5 DO TÚNEL: o Contábil (CCI) importa o FECHAMENTO, nunca a ficha.
//
// Paulo, 26/08: *"o departamento contábil, através do CCI, deve fazer a
// importação com a mesma exatidão dos valores apurados e o mês fechado"*.
//
// ═══ A DECISÃO QUE MANDA: ELE IMPORTA O CARIMBO, NÃO A FICHA ════════════════
//
// A ficha é um registro VIVO — alguém edita e o número muda. Se o túnel
// servisse a ficha, o Contábil puxaria um valor que pode mudar depois, e a
// divergência voltaria pela porta de trás, calada. O carimbo é imutável e
// VERSIONADO: é ele que atravessa.
//
// ═══ E O CCI NÃO RECALCULA — a ressalva PROÍBE ══════════════════════════════
//
// É a régua já provada no R-2055 (12/08): *"a ressalva PROÍBE recalcular do
// outro lado"*. Dois números para o mesmo fato é o pior defeito de um arquivo
// fiscal — e é exatamente isso que este túnel existe para impedir. Por isso a
// resposta leva RESULTADO, e a ressalva vai em toda linha.
//
// ═══ TRÊS RECUSAS DELIBERADAS ═══════════════════════════════════════════════
//
//  1. **Competência ABERTA não entrega valor.** `podeImportar` só é `true` em
//     'fechada'. Entregar número de mês aberto seria entregar um valor que
//     ainda vai mudar — o problema inteiro.
//  2. **REABERTA BLOQUEIA a importação** (decisão do Paulo, 26/08 — ele abriu
//     exceção à régua da casa "acende, não bloqueia", *"porque é dinheiro em
//     duas contabilidades"*). E a resposta DIZ qual versão o Contábil pode ter
//     importado, senão ele fica com o número velho sem saber que ele mudou.
//  3. **Empresa sem fechamento NÃO SOME da lista.** Ela vem com
//     `estado: 'aberta'` — sumir faria o Contábil concluir "este cliente não
//     teve movimento", que é uma afirmação que ninguém fez.
// ============================================================================

/** A frase que atravessa em TODA linha entregue. */
export const RESSALVA_NAO_RECALCULAR =
    'Estes valores foram APURADOS e FECHADOS no CFI. Importe-os como estão — não recalcule '
    + 'do lado do Contábil: dois números para o mesmo fato é o defeito que este fechamento '
    + 'existe para impedir.';

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Uma linha do túnel, a partir do carimbo (ou da falta dele).
 *
 * @param {object} p
 * @param {object} p.empresa      { id, cnpj, nome }
 * @param {string} p.competencia  'AAAA-MM'
 * @param {object|null} p.fechamento  o documento de `fechamentos_competencia`
 */
export function linhaDoFechamento({ empresa, competencia, fechamento }) {
    const base = {
        empresaId: empresa?.id || null,
        cnpj: String(empresa?.cnpj || '').replace(/\D/g, '') || null,
        nome: empresa?.nome || null,
        competencia: competencia || null,
    };

    if (!fechamento) {
        return {
            ...base,
            estado: 'aberta',
            podeImportar: false,
            versao: null,
            motivo: 'O fim de mês desta competência ainda não foi dado no CFI. Enquanto isso os '
                + 'valores podem mudar, então não há o que importar.',
            apurado: null, lastro: null, corte: null,
            fechadoEm: null, fechadoPor: null,
        };
    }

    if (fechamento.estado === 'reaberta') {
        const ultima = (fechamento.reaberturas || []).slice(-1)[0] || null;
        return {
            ...base,
            estado: 'reaberta',
            podeImportar: false,
            // 🚨 A VERSÃO QUE O CONTÁBIL PODE TER IMPORTADO. Sem ela, ele fica
            // com o número velho sem saber que ele mudou — que é a divergência
            // que este túnel existe para matar.
            versao: num(fechamento.versao),
            versaoQueVoceTalvezTenha: num(ultima?.versaoReaberta),
            motivo: `A competência foi REABERTA${ultima?.por ? ` por ${ultima.por}` : ''}`
                + `${ultima?.motivo ? ` — ${ultima.motivo}` : ''}. `
                + 'Se você já importou a versão anterior, ela está desatualizada: espere o CFI '
                + 'fechar de novo e importe a versão nova.',
            apurado: null, lastro: null, corte: null,
            fechadoEm: null, fechadoPor: null,
        };
    }

    if (fechamento.estado !== 'fechada') {
        return { ...base, estado: 'aberta', podeImportar: false, versao: null,
            motivo: 'Estado do fechamento não reconhecido — não há o que importar.',
            apurado: null, lastro: null, corte: null, fechadoEm: null, fechadoPor: null };
    }

    return {
        ...base,
        estado: 'fechada',
        podeImportar: true,
        versao: num(fechamento.versao),
        fechadoEm: fechamento.fechadoEm || null,
        fechadoPor: fechamento.fechadoPor?.email || null,
        // RESULTADO, nunca insumo — o carimbo já nasce assim (`CAMPOS_APURADOS`).
        apurado: fechamento.apurado || null,
        // 🔒 DE ONDE VEIO O APURADO, e a ressalva quando ele é do Simples.
        //
        // Sem isto o Contábil recebe um `apurado` todo `null` e conclui *"este
        // cliente não teve movimento"* — afirmação que ninguém fez. No Simples
        // o valor do DAS não vive na ficha: ele é emitido no card do Simples,
        // e o que este carimbo congela é o ACERVO e o LASTRO do mês.
        apuradoFonte: fechamento.apuradoFonte || null,
        apuradoRessalva: fechamento.apuradoRessalva || null,
        // 🚨 O LASTRO ATRAVESSA. Sem ele o Contábil importa número fechado que
        // pode ter ZERO documento por trás (o caso EXPERTE, 15/08) sem nenhuma
        // ressalva na tela dele.
        lastro: fechamento.lastro
            ? {
                situacao: fechamento.lastro.situacao || null,
                cor: fechamento.lastro.cor || null,
                mensagem: fechamento.lastro.mensagem || null,
            }
            : null,
        // A PROVA de qual acervo virou este número.
        corte: fechamento.corte
            ? {
                instante: fechamento.corte.instante || null,
                ultNSU: num(fechamento.corte.ultNSU),
                maxNSU: num(fechamento.corte.maxNSU),
                documentos: num(fechamento.corte.documentos?.total),
            }
            : null,
        ressalva: RESSALVA_NAO_RECALCULAR,
        reaberturas: (fechamento.reaberturas || []).length,
    };
}

/** O resumo da competência — para o CCI saber o que ainda falta fechar. */
export function resumirFechamentos(linhas) {
    const l = Array.isArray(linhas) ? linhas : [];
    return {
        total: l.length,
        importaveis: l.filter((x) => x.podeImportar).length,
        abertas: l.filter((x) => x.estado === 'aberta').length,
        reabertas: l.filter((x) => x.estado === 'reaberta').length,
        // ⚠️ Contado à parte: número fechado SEM documento por trás é
        // importável e merece olho humano do outro lado.
        semLastro: l.filter((x) => x.podeImportar && x.lastro && x.lastro.cor === 'falha').length,
    };
}
