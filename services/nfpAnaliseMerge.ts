/**
 * services/nfpAnaliseMerge.ts
 *
 * Merge colaborativo da análise NFP Pro Cloud (doc único por empresa).
 *
 * Vários colaboradores — de departamentos diferentes — lançam apontamentos
 * na MESMA análise (débitos, certidões, obrigações, parcelamentos, ações e
 * plano de ação). O documento Firestore é um só, e `setDoc` substitui os
 * arrays por inteiro: sem merge, o último a salvar apagaria os lançamentos
 * dos demais.
 *
 * Regras do merge (local = estado da tela de quem salva; remota = doc salvo;
 * baseline = snapshot que essa tela carregou do servidor):
 *  - item com mesmo id nos dois lados → a versão local vence (é a edição);
 *  - item só na remota e FORA do baseline → preservado (outra pessoa lançou
 *    depois do carregamento desta tela);
 *  - item só na remota mas DENTRO do baseline → descartado (esta tela o
 *    carregou e o usuário o removeu de propósito);
 *  - certidões/obrigações/plano de ação têm chave natural além do id, para
 *    não duplicar as linhas-base geradas por rascunhos independentes.
 */
import type { NfpAnaliseEmpresa } from '../types';

const norm = (s: string) => (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

interface ComId { id: string }

function mesclarLista<T extends ComId>(
    locais: T[] | undefined,
    remotos: T[] | undefined,
    baselineIds: Set<string>,
    chaveNatural?: (item: T) => string,
): T[] {
    const loc = locais || [];
    const rem = remotos || [];
    const idsLocais = new Set(loc.map(i => i.id));
    const chavesLocais = chaveNatural ? new Set(loc.map(chaveNatural)) : null;
    const preservados = rem.filter(r => {
        if (idsLocais.has(r.id)) return false;
        if (baselineIds.has(r.id)) return false;
        if (chavesLocais && chaveNatural && chavesLocais.has(chaveNatural(r))) return false;
        return true;
    });
    return [...loc, ...preservados];
}

const ids = (lista?: ComId[]) => new Set((lista || []).map(i => i.id));

/**
 * Mescla o estado local com a versão salva no servidor sem perder os
 * lançamentos feitos por outros colaboradores. Retorna `local` intacta
 * quando não há versão remota.
 */
export function mesclarAnaliseComRemota(
    local: NfpAnaliseEmpresa,
    remota: NfpAnaliseEmpresa | null | undefined,
    baseline?: NfpAnaliseEmpresa | null,
): NfpAnaliseEmpresa {
    if (!remota) return local;
    return {
        ...local,
        debitos: mesclarLista(local.debitos, remota.debitos, ids(baseline?.debitos)),
        parcelamentos: mesclarLista(local.parcelamentos, remota.parcelamentos, ids(baseline?.parcelamentos)),
        acoes: mesclarLista(local.acoes, remota.acoes, ids(baseline?.acoes)),
        certidoes: mesclarLista(
            local.certidoes, remota.certidoes, ids(baseline?.certidoes),
            c => norm(`${c.esfera}|${c.orgao}|${c.tipo}`),
        ),
        obrigacoes: mesclarLista(
            local.obrigacoes, remota.obrigacoes, ids(baseline?.obrigacoes),
            o => norm(`${o.esfera}|${o.sigla || o.nome}`),
        ),
        planoAcao: mesclarLista(
            local.planoAcao, remota.planoAcao, ids(baseline?.planoAcao),
            p => norm(p.descricao),
        ),
        apontamentosTrabalhistas: mesclarLista(
            local.apontamentosTrabalhistas, remota.apontamentosTrabalhistas,
            ids(baseline?.apontamentosTrabalhistas),
        ),
        analiseIA: local.analiseIA || remota.analiseIA,
    };
}
