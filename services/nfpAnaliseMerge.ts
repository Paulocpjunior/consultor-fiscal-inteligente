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
 *  - alterações independentes são mescladas por campo usando o baseline;
 *  - alterações incompatíveis recusam o salvamento, sem apagar dados;
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

const igual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const aa = a as Record<string, unknown>;
    const bb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    return [...keys].every(k => igual(aa[k], bb[k]));
};

function conflito(): never {
    throw new Error('Outro colaborador alterou o mesmo registro. As alterações não foram salvas. Recarregue a análise e confira os campos antes de salvar novamente.');
}

function mesclarItem<T extends ComId>(local: T, remoto: T, base: T): T {
    const resultado = { ...remoto };
    for (const key of new Set([...Object.keys(local), ...Object.keys(base)])) {
        const campo = key as keyof T;
        if (igual(local[campo], base[campo])) continue;
        if (!igual(remoto[campo], base[campo]) && !igual(local[campo], remoto[campo])) conflito();
        if (Object.prototype.hasOwnProperty.call(local, campo)) resultado[campo] = local[campo];
        else delete resultado[campo];
    }
    return resultado;
}

function mesclarLista<T extends ComId>(
    locais: T[] | undefined,
    remotos: T[] | undefined,
    baseline: T[] | undefined,
    chaveNatural?: (item: T) => string,
): T[] {
    const loc = locais || [];
    const rem = remotos || [];
    const bases = new Map((baseline || []).map(i => [i.id, i]));
    const remPorId = new Map(rem.map(i => [i.id, i]));
    const atualizados = loc.flatMap(item => {
        const base = bases.get(item.id);
        const remoto = remPorId.get(item.id);
        if (!base) return [item];
        if (!remoto) {
            if (!igual(item, base)) conflito();
            return [];
        }
        return [mesclarItem(item, remoto, base)];
    });
    const idsLocais = new Set(loc.map(i => i.id));
    const chavesLocais = chaveNatural ? new Set(loc.map(chaveNatural)) : null;
    const preservados = rem.filter(r => {
        if (idsLocais.has(r.id)) return false;
        const base = bases.get(r.id);
        if (base) {
            if (!igual(r, base)) conflito();
            return false;
        }
        if (chavesLocais && chaveNatural && chavesLocais.has(chaveNatural(r))) return false;
        return true;
    });
    return [...atualizados, ...preservados];
}


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
        debitos: mesclarLista(local.debitos, remota.debitos, baseline?.debitos),
        parcelamentos: mesclarLista(local.parcelamentos, remota.parcelamentos, baseline?.parcelamentos),
        acoes: mesclarLista(local.acoes, remota.acoes, baseline?.acoes),
        certidoes: mesclarLista(
            local.certidoes, remota.certidoes, baseline?.certidoes,
            c => norm(`${c.esfera}|${c.orgao}|${c.tipo}`),
        ),
        obrigacoes: mesclarLista(
            local.obrigacoes, remota.obrigacoes, baseline?.obrigacoes,
            o => norm(`${o.esfera}|${o.sigla || o.nome}`),
        ),
        planoAcao: mesclarLista(
            local.planoAcao, remota.planoAcao, baseline?.planoAcao,
            p => norm(p.descricao),
        ),
        apontamentosTrabalhistas: mesclarLista(
            local.apontamentosTrabalhistas, remota.apontamentosTrabalhistas,
            baseline?.apontamentosTrabalhistas,
        ),
        analiseIA: local.analiseIA || remota.analiseIA,
    };
}
