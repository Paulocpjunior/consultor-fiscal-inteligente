/**
 * services/pgdasMapper.ts
 *
 * Pure function: converte o estado do SimplesNacionalDetalhe + resumo calculado
 * em payload PGDAS-D do SERPRO (idServico TRANSDECLARACAO11).
 *
 * Especificacao SERPRO:
 * https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/cenarios_trial/cenarios_pgdasd/
 *
 * Decisoes simplificadoras (1a versao):
 * - Estabelecimento unico = matriz (CNPJ raiz). Filiais ficam pra refinamento futuro.
 * - Atividades agregadas em comercio (idAtividade=1), industria (idAtividade=2),
 *   servicos (idAtividade=3). Detalhamento por CNAE/anexo fica pra refinamento.
 * - Receitas internas vs externas usam totalMercadoInterno/Externo do resumo.
 * - tipoDeclaracao e setado pelo backend apos consultar se ja existe declaracao.
 *
 * Quando SERPRO retornar erro de campo faltando, refinamos esse mapper.
 */
import type { Empresa, SimplesNacionalResumo } from '../types';

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
    empresa: Empresa;
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
                    municipioISS: number | null;
                    ufICMS: string | null;
                    qualificacaoTributaria: number;
                }>;
            }>;
        }>;
        folhaSalario12m: number | null;
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

export function mapPgdasPayload(input: PgdasMapperInput): PgdasPayload {
    const { empresa, resumo, mesApuracao, faturamentoPorCnae, filialComercio, filialIndustria, filialServico, icmsVendas } = input;

    const cnpjLimpo = String(empresa.cnpj || '').replace(/\D/g, '');
    const pa = paFromDate(mesApuracao);
    const competencia = `${mesApuracao.getFullYear()}-${String(mesApuracao.getMonth() + 1).padStart(2, '0')}`;
    const regime = empresa.regimeApuracao || 'competencia';

    // Receitas agregadas por tipo (atividade)
    let totalComercio = filialComercio || 0;
    let totalIndustria = filialIndustria || 0;
    let totalServico = filialServico || 0;
    let totalExterno = 0;

    // CNAE itens: classifica por anexo
    const cnaeAtividades: Array<{ valor: number; isExterior: boolean; issRetido: boolean }> = [];
    Object.entries(faturamentoPorCnae).forEach(([key, state]) => {
        const v = parseValorBr(state.valor);
        if (state.isExterior) {
            totalExterno += v;
        } else {
            // Por simplicidade, classifica como servico (Anexo III) por default
            // Refinamento futuro: usar empresa.atividades pra mapear CNAE -> anexo
            totalServico += v;
        }
        cnaeAtividades.push({ valor: v, isExterior: state.isExterior, issRetido: state.issRetido });
    });

    const receitaInternaPa = totalComercio + totalIndustria + totalServico;

    // Atividades do estabelecimento matriz
    const atividades: PgdasPayload['declaracao']['estabelecimentos'][0]['atividades'] = [];
    const ufEmpresa = empresa.dadosFiscais?.uf || '';
    const codMunIBGE = empresa.dadosFiscais?.codMunIBGE ? Number(empresa.dadosFiscais.codMunIBGE) : null;

    if (totalComercio > 0) {
        atividades.push({
            idAtividade: 1,
            valorAtividade: totalComercio,
            receitasAtividade: [{
                valor: totalComercio,
                municipioISS: null,
                ufICMS: ufEmpresa,
                qualificacaoTributaria: 1,  // 1 = sem ST/monofasica
            }],
        });
    }
    if (totalIndustria > 0) {
        atividades.push({
            idAtividade: 2,
            valorAtividade: totalIndustria,
            receitasAtividade: [{
                valor: totalIndustria,
                municipioISS: null,
                ufICMS: ufEmpresa,
                qualificacaoTributaria: 1,
            }],
        });
    }
    if (totalServico > 0) {
        atividades.push({
            idAtividade: 3,
            valorAtividade: totalServico,
            receitasAtividade: [{
                valor: totalServico,
                municipioISS: codMunIBGE,
                ufICMS: null,
                qualificacaoTributaria: 1,
            }],
        });
    }

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
        receitasBrutasAnteriores.push({ pa: paAnt, valorInterno, valorExterno: 0 });
    }

    return {
        declaracao: {
            receitaPaCompetenciaInterno: regime === 'competencia' ? receitaInternaPa : 0,
            receitaPaCompetenciaExterno: regime === 'competencia' ? totalExterno : 0,
            receitaPaCaixaInterno: regime === 'caixa' ? receitaInternaPa : null,
            receitaPaCaixaExterno: regime === 'caixa' ? totalExterno : null,
            valorFixoIcms: icmsVendas > 0 ? icmsVendas : null,
            valorFixoIss: null,
            receitasBrutasAnteriores,
            estabelecimentos: [{
                cnpjCompleto: cnpjLimpo,
                atividades,
            }],
            folhaSalario12m: empresa.folha12 || null,
        },
        _competencia: competencia,
        _cnpjLimpo: cnpjLimpo,
    };
}
