/**
 * services/pgdasMapper.ts
 *
 * Pure function: converte o estado do SimplesNacionalDetalhe + resumo calculado
 * em payload PGDAS-D do SERPRO (idServico TRANSDECLARACAO11).
 *
 * Especificacao SERPRO:
 * https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_entrada/
 *
 * Decisoes:
 * - Estabelecimento unico = matriz (CNPJ raiz). Filiais entram agregadas por
 *   tipo de atividade, mantendo a mesma regra usada na apuracao da tela.
 * - Atividades usam os ids oficiais do dominio PGDAS-D (comercio 1/2/3,
 *   industria 4/5/6, servicos 10-18/29-31 conforme anexo/ISS/exterior).
 * - Campos enviados em receitasAtividade seguem o schema oficial; valores
 *   nulos ou nomes legados nao sao enviados.
 * - tipoDeclaracao e setado pelo backend apos consultar se ja existe declaracao.
 */
import type { SimplesNacionalEmpresa, SimplesNacionalResumo } from '../types';

interface CnaeInputState {
    valor: string;
    issRetido: boolean;
    icmsSt: boolean;
    isSup: boolean;
    isMonofasico: boolean;
    isImune: boolean;
    isExterior: boolean;
}

export interface PgdasMapperInput {
    empresa: SimplesNacionalEmpresa;
    resumo: SimplesNacionalResumo;
    mesApuracao: Date;
    faturamentoPorCnae: Record<string, CnaeInputState>;
    filialComercio: number;
    filialIndustria: number;
    filialServico: number;
    icmsVendas: number;
}

export interface PgdasPayload {
    declaracao: {
        receitaPaCompetenciaInterno: number;
        receitaPaCompetenciaExterno: number;
        receitaPaCaixaInterno: number | null;
        receitaPaCaixaExterno: number | null;
        valorFixoIcms: number | null;
        valorFixoIss: number | null;
        receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
        estabelecimentos: Array<{
            cnpjCompleto: string;
            atividades: Array<{
                idAtividade: number;
                valorAtividade: number;
                receitasAtividade: Array<{
                    valor: number;
                    codigoOutroMunicipio?: string;
                    outraUf?: string;
                    qualificacoesTributarias?: Array<{
                        codigoTributo: number;
                        id: number;
                    }>;
                }>;
            }>;
        }>;
        folhasSalario?: Array<{ pa: number; valor: number }>;
    };
    // tipoDeclaracao e setado pelo backend
    _competencia: string;  // YYYY-MM original
    _cnpjLimpo: string;
}

function paFromDate(d: Date): number {
    return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function paAnterior(pa: number, mesesAtras: number): number {
    // pa = AAAAMM. Retrocede N meses.
    const ano = Math.floor(pa / 100);
    const mes = pa % 100;
    const totalMeses = ano * 12 + (mes - 1) - mesesAtras;
    return Math.floor(totalMeses / 12) * 100 + (totalMeses % 12) + 1;
}

function parseValorBr(s: string): number {
    if (!s) return 0;
    const cleaned = String(s).replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function assinaturaReceita(receita: ReceitaAtividade): string {
    const { valor: _valor, ...semValor } = receita;
    return JSON.stringify(semValor);
}

function anexoFromKey(key: string, fallback: SimplesNacionalEmpresa['anexo']): SimplesNacionalEmpresa['anexo'] {
    const parts = key.split('::');
    const maybeAnexo = parts.length >= 4 ? (parts[3] ?? '') : '';
    return (['I', 'II', 'III', 'IV', 'V', 'III_V'].includes(maybeAnexo)
        ? maybeAnexo
        : fallback) as SimplesNacionalEmpresa['anexo'];
}

function resolveAnexoEfetivo(
    anexo: SimplesNacionalEmpresa['anexo'],
    fatorR: number,
): SimplesNacionalEmpresa['anexo'] {
    if (anexo === 'III_V') return fatorR >= 0.28 ? 'III' : 'V';
    if (anexo === 'V' && fatorR >= 0.28) return 'III';
    return anexo;
}

function idAtividadePgdas(
    anexoOriginal: SimplesNacionalEmpresa['anexo'],
    state: Pick<CnaeInputState, 'issRetido' | 'icmsSt' | 'isMonofasico' | 'isExterior'>,
    fatorR: number,
): number {
    const anexo = resolveAnexoEfetivo(anexoOriginal, fatorR);
    const temStOuMono = state.icmsSt || state.isMonofasico;

    if (anexo === 'I') {
        if (state.isExterior) return 3;
        return temStOuMono ? 2 : 1;
    }

    if (anexo === 'II') {
        if (state.isExterior) return 6;
        return temStOuMono ? 5 : 4;
    }

    if (anexo === 'IV') {
        if (state.isExterior) return 31;
        return state.issRetido ? 18 : 17;
    }

    if (anexo === 'V') {
        if (state.isExterior) return 29;
        return state.issRetido ? 12 : 11;
    }

    // Anexo III sem fator R: ISS devido ao proprio municipio por padrao.
    if (state.isExterior) return 30;
    return state.issRetido ? 15 : 14;
}

function serviceFallbackAnexo(empresa: SimplesNacionalEmpresa): SimplesNacionalEmpresa['anexo'] {
    const anexo = resolveAnexoEfetivo(empresa.anexo, 0);
    return ['III', 'IV', 'V'].includes(anexo) ? anexo : 'III';
}

type ReceitaAtividade = PgdasPayload['declaracao']['estabelecimentos'][0]['atividades'][0]['receitasAtividade'][0];
type AtividadePgdas = PgdasPayload['declaracao']['estabelecimentos'][0]['atividades'][0];

function addAtividade(
    grupos: Map<number, AtividadePgdas>,
    idAtividade: number,
    valor: number,
    receita: ReceitaAtividade = { valor },
) {
    const valorArredondado = round2(valor);
    if (valorArredondado <= 0) return;

    const existente = grupos.get(idAtividade);
    const receitaFinal = { ...receita, valor: round2(receita.valor) };
    if (existente) {
        existente.valorAtividade = round2(existente.valorAtividade + valorArredondado);
        const assinaturaFinal = assinaturaReceita(receitaFinal);
        const receitaExistente = existente.receitasAtividade
            .find((item) => assinaturaReceita(item) === assinaturaFinal);
        if (receitaExistente) {
            receitaExistente.valor = round2(receitaExistente.valor + receitaFinal.valor);
            return;
        }
        existente.receitasAtividade.push(receitaFinal);
        return;
    }
    grupos.set(idAtividade, {
        idAtividade,
        valorAtividade: valorArredondado,
        receitasAtividade: [receitaFinal],
    });
}

function montarReceitaAtividade(
    state: Pick<CnaeInputState, 'issRetido' | 'icmsSt' | 'isMonofasico'>,
    valor: number,
): ReceitaAtividade {
    const qualificacoesTributarias: ReceitaAtividade['qualificacoesTributarias'] = [];

    if (state.icmsSt) {
        qualificacoesTributarias.push({ codigoTributo: 1007, id: 8 });
    }
    if (state.isMonofasico) {
        qualificacoesTributarias.push(
            { codigoTributo: 1004, id: 9 },
            { codigoTributo: 1005, id: 9 },
        );
    }
    if (state.issRetido) {
        qualificacoesTributarias.push({ codigoTributo: 1010, id: 11 });
    }

    const receita: ReceitaAtividade = { valor };
    if (qualificacoesTributarias.length > 0) {
        receita.qualificacoesTributarias = qualificacoesTributarias;
    }
    return receita;
}

export function mapPgdasPayload(input: PgdasMapperInput): PgdasPayload {
    const { empresa, resumo, mesApuracao, faturamentoPorCnae, filialComercio, filialIndustria, filialServico, icmsVendas } = input;

    const cnpjLimpo = String(empresa.cnpj || '').replace(/\D/g, '');
    const pa = paFromDate(mesApuracao);
    const competencia = `${mesApuracao.getFullYear()}-${String(mesApuracao.getMonth() + 1).padStart(2, '0')}`;
    const regime = empresa.regimeApuracao || 'competencia';

    const grupos = new Map<number, AtividadePgdas>();
    let totalExterno = 0;
    let totalInterno = 0;

    Object.entries(faturamentoPorCnae).forEach(([key, state]) => {
        const valor = round2(parseValorBr(state.valor));
        if (valor <= 0) return;
        const anexo = anexoFromKey(key, empresa.anexo);
        const idAtividade = idAtividadePgdas(anexo, state, resumo.fator_r || 0);
        addAtividade(grupos, idAtividade, valor, montarReceitaAtividade(state, valor));
        if (state.isExterior) totalExterno = round2(totalExterno + valor);
        else totalInterno = round2(totalInterno + valor);
    });

    const filialComercioSafe = round2(filialComercio || 0);
    const filialIndustriaSafe = round2(filialIndustria || 0);
    const filialServicoSafe = round2(filialServico || 0);

    if (filialComercioSafe > 0) {
        addAtividade(grupos, 1, filialComercioSafe);
        totalInterno = round2(totalInterno + filialComercioSafe);
    }
    if (filialIndustriaSafe > 0) {
        addAtividade(grupos, 4, filialIndustriaSafe);
        totalInterno = round2(totalInterno + filialIndustriaSafe);
    }
    if (filialServicoSafe > 0) {
        const idAtividade = idAtividadePgdas(
            serviceFallbackAnexo(empresa),
            { issRetido: true, icmsSt: false, isMonofasico: false, isExterior: false },
            resumo.fator_r || 0,
        );
        addAtividade(grupos, idAtividade, filialServicoSafe);
        totalInterno = round2(totalInterno + filialServicoSafe);
    }

    const atividades = Array.from(grupos.values())
        .sort((a, b) => a.idAtividade - b.idAtividade);

    // Historico 12 meses anteriores (faturamentoManual)
    const fatManual = empresa.faturamentoManual || {};
    const receitasBrutasAnteriores: PgdasPayload['declaracao']['receitasBrutasAnteriores'] = [];
    for (let i = 1; i <= 12; i++) {
        const paAnt = paAnterior(pa, i);
        const ano = Math.floor(paAnt / 100);
        const mes = paAnt % 100;
        const keyMmYyyy = `${String(mes).padStart(2, '0')}-${ano}`;
        const keyYyyyMm = `${ano}-${String(mes).padStart(2, '0')}`;
        const valorInterno = fatManual[keyMmYyyy] || fatManual[keyYyyyMm] || 0;
        receitasBrutasAnteriores.push({ pa: paAnt, valorInterno: round2(valorInterno), valorExterno: 0 });
    }

    const declaracao: PgdasPayload['declaracao'] = {
        receitaPaCompetenciaInterno: regime === 'competencia' ? totalInterno : 0,
        receitaPaCompetenciaExterno: regime === 'competencia' ? totalExterno : 0,
        receitaPaCaixaInterno: regime === 'caixa' ? totalInterno : null,
        receitaPaCaixaExterno: regime === 'caixa' ? totalExterno : null,
        valorFixoIcms: icmsVendas > 0 ? round2(icmsVendas) : null,
        valorFixoIss: null,
        receitasBrutasAnteriores,
        estabelecimentos: [{
            cnpjCompleto: cnpjLimpo,
            atividades,
        }],
    };

    const folhasSalario = Object.entries(empresa.folhaMensal || {})
        .map(([competenciaFolha, valor]) => {
            const match = competenciaFolha.match(/^(\d{4})-(\d{2})$/);
            if (!match) return null;
            return {
                pa: Number(`${match[1]}${match[2]}`),
                valor: round2(Number(valor) || 0),
            };
        })
        .filter((item): item is { pa: number; valor: number } => !!item && item.valor > 0 && item.pa < pa)
        .sort((a, b) => b.pa - a.pa)
        .slice(0, 12)
        .sort((a, b) => a.pa - b.pa);
    if (folhasSalario.length > 0) {
        declaracao.folhasSalario = folhasSalario;
    }

    return {
        declaracao,
        _competencia: competencia,
        _cnpjLimpo: cnpjLimpo,
    };
}
