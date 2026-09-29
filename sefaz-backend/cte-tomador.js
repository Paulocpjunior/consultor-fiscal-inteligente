/**
 * cte-tomador.js — QUEM ESCRITURA O CT-e. PURO, sem importar nada (é lido
 * pelo dono da direção, `xml-metadata-helper.js`, e não pode fechar ciclo).
 *
 * Paulo, 29/09, A CASTELLANO (Resumo por CFOP): *"o consultor está puxando o
 * CT-e vinculado à nota fiscal, não deveria aparecer na minha escrituração"*
 * — 50 conhecimentos com CFOP 5351/5353/6351/6352/6353 (o CFOP da
 * TRANSPORTADORA) saindo como SAÍDA da empresa.
 *
 * O CT-e chega pela DistribuiçãoDFe para todo interessado (remetente,
 * destinatário, expedidor, recebedor), mas quem o ESCRITURA é só quem está
 * numa das duas pontas da prestação: a transportadora (emitente, saída) e o
 * TOMADOR (quem contratou e paga o frete, entrada, CFOP 1/2xxx). O tomador
 * está no próprio XML: `<ide><toma3><toma>` (0 remetente · 1 expedidor · 2
 * recebedor · 3 destinatário) ou `<ide><toma4>` (4 = outro, com o CNPJ/CPF
 * dentro). Empresa que é só remetente ou destinatária da carga NÃO escritura
 * o frete — ele aparece na escrituração de quem o tomou.
 *
 * Documento gravado SEM o tomador (captura anterior a 29/09) continua
 * entrando como antes, DITO: "rode ♻️ Reler cabeçalho dos CT-e". Nada some
 * em silêncio.
 */
const so = (v) => String(v ?? '').replace(/\D/g, '');

/** É conhecimento de transporte (57/67)? — pelo tipo gravado ou pelo modelo da chave. */
export function ehCteDoc(d) {
    if (!d) return false;
    const t = String(d.tipoDoc || d.tipo || '');
    if (/^CTe/i.test(t)) return true;
    const mod = so(d.modelo) || String(d.chave || '').slice(20, 22);
    return mod === '57' || mod === '67';
}

export const PAPEIS_CTE = Object.freeze({
    emitente: 'transportadora (emitiu o CT-e) — saída',
    tomador: 'tomadora do frete (contratou e paga) — entrada',
    terceiro: 'só remetente/destinatária da carga — o frete é de quem o tomou',
    'sem-tomador': 'tomador não lido do XML — rode ♻️ Reler cabeçalho dos CT-e',
});

/** O papel da empresa neste CT-e. */
export function papelDaEmpresaNoCte(d, empresaCnpj) {
    if (!ehCteDoc(d)) return 'nao-cte';
    const emp = so(empresaCnpj || d?.empresaCnpj);
    // Sem o CNPJ da empresa não há como afirmar papel nenhum: entra como antes.
    if (!emp) return 'sem-empresa';
    const emit = so(d?.cnpjEmit || d?.emitente?.cnpjCpf || d?.emitente?.cnpj);
    if (emit && emp === emit) return 'emitente';
    const tomador = so(d?.cnpjTomadorCte);
    if (!tomador) return 'sem-tomador';
    return tomador === emp ? 'tomador' : 'terceiro';
}

/** A direção que o CT-e tem PARA ESTA EMPRESA — ou null quando não dá para afirmar. */
export function direcaoDoCte(d, empresaCnpj) {
    const papel = papelDaEmpresaNoCte(d, empresaCnpj);
    if (papel === 'emitente') return 'saida';
    if (papel === 'tomador') return 'entrada';
    return null;
}

/**
 * Entra na escrituração desta empresa?
 * @returns {{entra:boolean, papel:string, motivo:string}}
 */
export function cteEntraNaEscrituracao(d, empresaCnpj) {
    const papel = papelDaEmpresaNoCte(d, empresaCnpj);
    if (papel === 'nao-cte') return { entra: true, papel, motivo: '' };
    return { entra: papel !== 'terceiro', papel, motivo: PAPEIS_CTE[papel] || '' };
}

/** Seleção dos CT-e de uma empresa, com o que ficou de fora NOMEADO. */
export function selecionarCtes(notas, empresaCnpj) {
    const out = { notas: [], foraTerceiro: [], semTomador: [] };
    for (const d of notas || []) {
        if (!ehCteDoc(d)) continue;
        const r = cteEntraNaEscrituracao(d, empresaCnpj);
        const rotulo = String(d.numero || (d.chave ? String(d.chave).slice(25, 34).replace(/^0+/, '') : '') || d.id || '?');
        if (!r.entra) { out.foraTerceiro.push(rotulo); continue; }
        if (r.papel === 'sem-tomador') out.semTomador.push(rotulo);
        out.notas.push(d);
    }
    return out;
}

/** Os avisos da seleção — o que saiu e por quê, e o que entrou sem prova. */
export function avisosDosCtes(sel) {
    const avisos = [];
    const lista = (l) => `nº ${l.slice(0, 8).join(', ')}${l.length > 8 ? ` e mais ${l.length - 8}` : ''}`;
    if (sel?.foraTerceiro?.length) {
        avisos.push(`🚚 ${sel.foraTerceiro.length} CT-e ficaram FORA da escrituração porque a empresa NÃO é a tomadora do frete `
            + `(é só remetente/destinatária da carga) — ${lista(sel.foraTerceiro)}. O frete é escriturado por quem o tomou; `
            + 'se esta empresa pagou o frete, o CT-e está errado na origem (o tomador está no XML).');
    }
    if (sel?.semTomador?.length) {
        avisos.push(`🚚 ${sel.semTomador.length} CT-e entraram SEM prova de que a empresa é a tomadora (documento gravado antes `
            + `de o app ler o tomador) — ${lista(sel.semTomador)}. Rode ♻️ Reler cabeçalho dos CT-e (aba ✏️ CFOP por nota) `
            + 'para ler o tomador do XML guardado; os que forem de terceiro saem sozinhos.');
    }
    return avisos;
}
