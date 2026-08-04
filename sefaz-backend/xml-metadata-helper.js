export function competenciaFromDhEmi(value) {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}`;

    return null;
}

function pickFirstBlock(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1] : '';
}

function pickTag(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

export function extrairParticipantesNfe(xml) {
    const emit = pickFirstBlock(xml, 'emit');
    const dest = pickFirstBlock(xml, 'dest');

    // ENDEREÇO importa: o Exportar SAGE cadastra o participante (registro
    // E010) e o E-Fiscal RECUSA sem UF ("Campo 10, UF inválida"). Até 04/08 só
    // guardávamos o CNPJ do destinatário — nas SAÍDAS, que é justamente onde o
    // participante É o destinatário, o E010 saía com nome "CLIENTE" e UF em
    // branco e derrubava a importação inteira em cascata (caso 04/08: 30 sem
    // UF ⇒ 54 notas recusadas). O bloco <enderDest> sempre veio no XML.
    const endEmit = pickFirstBlock(emit, 'enderEmit');
    const endDest = pickFirstBlock(dest, 'enderDest');

    return {
        emitente: {
            cnpj: pickTag(emit, 'CNPJ') || pickTag(emit, 'CPF') || null,
            nome: pickTag(emit, 'xNome') || null,
            uf: pickTag(endEmit, 'UF') || null,
            codMunIBGE: pickTag(endEmit, 'cMun') || null,
            ie: pickTag(emit, 'IE') || null,
        },
        destinatario: {
            cnpj: pickTag(dest, 'CNPJ') || pickTag(dest, 'CPF') || null,
            nome: pickTag(dest, 'xNome') || null,
            uf: pickTag(endDest, 'UF') || null,
            codMunIBGE: pickTag(endDest, 'cMun') || null,
            ie: pickTag(dest, 'IE') || null,
        },
    };
}

/**
 * Direção EFETIVA de um doc já gravado — a régua única de leitura.
 *
 * O importer antigo marcava 'saida' sempre que a empresa era a emitente,
 * ignorando o tpNF: nota própria de ENTRADA (tpNF=0 — compra de produtor
 * rural PF, retorno etc.) ficava como saída, o Exportar SAGE recusava o CFOP
 * 1xxx/2xxx e a DIPAM não via a compra (31/07, caso EDUARDO GUERRA). O
 * backfill do sync-cron corrige o banco aos poucos; esta função corrige a
 * LEITURA na hora, para o painel não depender do próximo ciclo.
 */
export function direcaoEfetivaDoc(d) {
    if (!d) return undefined;
    if (d.direcao === 'saida' && String(d.tpNF ?? '') === '0') return 'entrada';
    return d.direcao;
}
