/**
 * Resumo da Carteira — a conta que o Paulo pediu (31/07): "total por
 * colaborador, com pendências ou sem, total sem colaborador".
 *
 * Cruza três fontes que a tela Carteira já carrega: empresas (com os campos
 * de cadastro), vínculos da carteira e a conferência de cadastro
 * (cadastroClientePendencias). Função pura — a tela só desenha.
 *
 * Farol honesto: pendência que TRAVA trilho (bloqueio) nunca some no
 * agregado — cada linha separa "com bloqueio" de "só atenção" de "ok".
 * Empresa com mais de um responsável conta na linha de CADA um (a soma das
 * linhas pode passar do total geral — o total geral é a verdade).
 */
import {
    conferirCadastroCliente,
    resumirCadastro,
    type EmpresaParaConferir,
    type ResumoCadastro,
} from './cadastroClientePendencias';

export interface EmpresaComCadastro extends EmpresaParaConferir {
    id: string;
    nome?: string | null;
    fonte?: 'simples' | 'lucro' | string;
}

export interface VinculoResumo {
    empresaId: string;
    colaboradorUid: string;
    colaboradorNome: string;
    papel?: string | null;
}

export interface ContagemFarol {
    total: number;
    comBloqueio: number;
    soAtencao: number;
    ok: number;
}

export interface LinhaColaborador extends ContagemFarol {
    colaboradorUid: string;
    colaboradorNome: string;
    /** Quantas das empresas dele são vínculo principal (vs backup). */
    comoPrincipal: number;
}

export interface ResumoCarteira {
    totalEmpresas: number;
    geral: ContagemFarol;
    semResponsavel: ContagemFarol;
    porColaborador: LinhaColaborador[];
    /** Farol por empresa (empresaId → resumo) pra tela reaproveitar nos cards. */
    farolPorEmpresa: Map<string, ResumoCadastro>;
}

function contagemVazia(): ContagemFarol {
    return { total: 0, comBloqueio: 0, soAtencao: 0, ok: 0 };
}

function somar(c: ContagemFarol, farol: ResumoCadastro['farol']) {
    c.total++;
    if (farol === 'bloqueado') c.comBloqueio++;
    else if (farol === 'atencao') c.soAtencao++;
    else c.ok++;
}

export function resumirCarteira(
    empresas: EmpresaComCadastro[],
    vinculos: VinculoResumo[],
): ResumoCarteira {
    const vinculosPorEmpresa = new Map<string, VinculoResumo[]>();
    for (const v of vinculos) {
        if (!v?.empresaId || !v?.colaboradorUid) continue;
        const arr = vinculosPorEmpresa.get(v.empresaId) || [];
        arr.push(v);
        vinculosPorEmpresa.set(v.empresaId, arr);
    }

    const geral = contagemVazia();
    const semResponsavel = contagemVazia();
    const porColab = new Map<string, LinhaColaborador>();
    const farolPorEmpresa = new Map<string, ResumoCadastro>();

    for (const e of empresas) {
        const vincs = vinculosPorEmpresa.get(e.id) || [];
        // A conferência precisa saber dos responsáveis reais — senão toda
        // empresa atribuída seguiria "pendente de responsável".
        const resumo = resumirCadastro(conferirCadastroCliente({
            ...e,
            // A lista de empresas traz o regime em `fonte` ('simples'|'lucro');
            // sem esta linha a checagem do Anexo do Simples NUNCA rodava e a
            // empresa sem anexo passava por "cadastro completo" (o DAS é que
            // não calculava).
            regime: e.regime ?? e.fonte ?? null,
            responsaveis: vincs.map((v) => ({ nome: v.colaboradorNome, papel: v.papel || 'principal' })),
        }));
        farolPorEmpresa.set(e.id, resumo);
        somar(geral, resumo.farol);

        if (vincs.length === 0) {
            somar(semResponsavel, resumo.farol);
            continue;
        }
        // Empresa com principal + backup conta pros DOIS (cada um enxerga a
        // própria carga) — deduplicado por colaborador dentro da empresa.
        const vistos = new Set<string>();
        for (const v of vincs) {
            if (vistos.has(v.colaboradorUid)) continue;
            vistos.add(v.colaboradorUid);
            let linha = porColab.get(v.colaboradorUid);
            if (!linha) {
                linha = { colaboradorUid: v.colaboradorUid, colaboradorNome: v.colaboradorNome, comoPrincipal: 0, ...contagemVazia() };
                porColab.set(v.colaboradorUid, linha);
            }
            somar(linha, resumo.farol);
            if (vincs.some((x) => x.colaboradorUid === v.colaboradorUid && (x.papel || 'principal') === 'principal')) {
                linha.comoPrincipal++;
            }
        }
    }

    // Mais empresas primeiro; empate por nome.
    const porColaborador = [...porColab.values()].sort(
        (a, b) => (b.total - a.total) || a.colaboradorNome.localeCompare(b.colaboradorNome),
    );

    return { totalEmpresas: empresas.length, geral, semResponsavel, porColaborador, farolPorEmpresa };
}

/** CSV do resumo (uma linha por colaborador + a linha "SEM RESPONSÁVEL"). */
export function resumoCarteiraCsv(r: ResumoCarteira): string {
    const linhas = [
        'colaborador;empresas;como_principal;com_bloqueio;so_atencao;cadastro_ok',
        ...r.porColaborador.map((l) =>
            [l.colaboradorNome, l.total, l.comoPrincipal, l.comBloqueio, l.soAtencao, l.ok].join(';')),
        ['SEM RESPONSÁVEL', r.semResponsavel.total, 0, r.semResponsavel.comBloqueio, r.semResponsavel.soAtencao, r.semResponsavel.ok].join(';'),
        ['TOTAL GERAL', r.geral.total, '', r.geral.comBloqueio, r.geral.soAtencao, r.geral.ok].join(';'),
    ];
    return linhas.join('\n');
}
