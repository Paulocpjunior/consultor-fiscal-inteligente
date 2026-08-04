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

/** Receita de UMA filial na competência, repartida por atividade. */
export interface FilialReceitaInput {
    cnpj: string;      // CNPJ completo (14 díg) da filial
    comercio: number;  // Anexo I
    industria: number; // Anexo II
    servico: number;   // Anexo III/IV/V
}

export interface PgdasMapperInput {
    empresa: SimplesNacionalEmpresa;
    resumo: SimplesNacionalResumo;
    mesApuracao: Date;
    faturamentoPorCnae: Record<string, CnaeInputState>;
    // LEGADO: buckets consolidados na matriz (empresas sem filiais cadastradas).
    filialComercio: number;
    filialIndustria: number;
    filialServico: number;
    // NOVO: receita por estabelecimento filial. Quando informado (com valor),
    // cada CNPJ vira um estabelecimento próprio no PGDAS-D e os buckets
    // consolidados acima são IGNORADOS (evita dupla contagem).
    filiaisReceita?: FilialReceitaInput[];
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
    /** Meta do app (NÃO vai ao SERPRO): marcações que o mapper ainda não traduz. */
    _avisos?: string[];
    /** Meta do app: motivos que IMPEDEM a transmissão (o backend também recusa). */
    _bloqueios?: string[];
    /** Meta do app: há receita marcada ISS fixo (SUP)? O backend revalida por isso. */
    _temSup?: boolean;
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

function diferencaMesesPaInclusiva(paInicio: number, paFim: number): number {
    const anoInicio = Math.floor(paInicio / 100);
    const mesInicio = paInicio % 100;
    const anoFim = Math.floor(paFim / 100);
    const mesFim = paFim % 100;
    return (anoFim - anoInicio) * 12 + (mesFim - mesInicio) + 1;
}

function paInicioAtividade(empresa: SimplesNacionalEmpresa): number | null {
    if (!empresa.dataAbertura) return null;
    const data = new Date(`${empresa.dataAbertura}T00:00:00`);
    if (isNaN(data.getTime())) return null;
    return paFromDate(new Date(data.getFullYear(), data.getMonth(), 1));
}

function quantidadeMesesReceitasAnteriores(
    empresa: SimplesNacionalEmpresa,
    resumo: SimplesNacionalResumo,
    pa: number,
): number {
    if (resumo.inicioAtividade && Number.isFinite(resumo.mesesAtividade)) {
        return Math.max(0, Math.min(12, Math.floor(Number(resumo.mesesAtividade))));
    }

    const paInicio = paInicioAtividade(empresa);
    if (!paInicio) return 12;

    const paMesAnterior = paAnterior(pa, 1);
    const mesesDesdeAbertura = diferencaMesesPaInclusiva(paInicio, paMesAnterior);
    return Math.max(0, Math.min(12, mesesDesdeAbertura));
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

function anexoExigeFolhaSalario(anexo: SimplesNacionalEmpresa['anexo']): boolean {
    return anexo === 'III_V' || anexo === 'V';
}

/**
 * Atividade oficial do PGDAS-D para "Prestação de Serviços, exceto para o
 * exterior — Escritórios de serviços contábeis autorizados pela legislação
 * municipal a pagar o ISS em valor fixo em guia do Município" (LC 123 art. 18
 * §22-A): usa as alíquotas do Anexo III DESCONSIDERANDO o percentual do ISS,
 * que o escritório paga direto ao município. É a indicação correta da S&P
 * (Paulo, 03/08/2026) — hoje essa receita ia como "ISS retido pelo tomador".
 *
 * O NÚMERO desta atividade não está na tela do PGDAS-D nem na doc do SERPRO
 * acessível deste ambiente. Ele vem do BANCO (coleção pgdas_atividades_codigos,
 * cadastrada pelo admin a partir de uma declaração real) — não de uma constante
 * do código: destravar um cliente não pode depender de deploy. Enquanto não
 * existir, `bloqueiosDoPayload` RECUSA a emissão dessa receita, e o backend
 * revalida contra o banco (cliente desatualizado não fura a trava).
 */
let idAtividadeIssFixoCadastrado: number | null = null;

/** Carrega o código vindo do backend (GET /das/atividade-iss-fixo). */
export function definirCodigoAtividadeIssFixo(id: number | null | undefined): void {
    idAtividadeIssFixoCadastrado = Number.isInteger(id as number) ? (id as number) : null;
}

/** Código em uso agora (null = SUP bloqueado). */
export function codigoAtividadeIssFixo(): number | null {
    return idAtividadeIssFixoCadastrado;
}

/** A receita tem o ISS fora do DAS? (retido pelo tomador OU fixo em guia do município) */
const issForaDoDas = (state: Pick<CnaeInputState, 'issRetido' | 'isSup'>): boolean =>
    !!state.issRetido || !!state.isSup;

function idAtividadePgdas(
    anexoOriginal: SimplesNacionalEmpresa['anexo'],
    state: Pick<CnaeInputState, 'issRetido' | 'icmsSt' | 'isSup' | 'isMonofasico' | 'isExterior'>,
    fatorR: number,
): number {
    const anexo = resolveAnexoEfetivo(anexoOriginal, fatorR);
    const temStOuMono = state.icmsSt || state.isMonofasico;

    // ISS fixo do escritório contábil é tributado pelo Anexo III (§22-A). Só
    // vale quando a atividade oficial já estiver mapeada; senão cai no
    // tratamento de "ISS fora do DAS" abaixo, que preserva o valor.
    if (state.isSup && !state.isExterior && idAtividadeIssFixoCadastrado !== null) {
        return idAtividadeIssFixoCadastrado;
    }

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
        return issForaDoDas(state) ? 18 : 17;
    }

    if (anexo === 'V') {
        if (state.isExterior) return 29;
        return issForaDoDas(state) ? 12 : 11;
    }

    // Anexo III sem fator R: ISS devido ao proprio municipio por padrao.
    if (state.isExterior) return 30;
    return issForaDoDas(state) ? 15 : 14;
}

function serviceFallbackAnexo(empresa: SimplesNacionalEmpresa): SimplesNacionalEmpresa['anexo'] {
    const anexo = resolveAnexoEfetivo(empresa.anexo, 0);
    return ['III', 'IV', 'V'].includes(anexo) ? anexo : 'III';
}

const soDigitos = (v: string) => String(v || '').replace(/\D/g, '');

/**
 * Monta as atividades de UM estabelecimento a partir da receita repartida por
 * tipo (comércio Anexo I → idAtividade 1; indústria Anexo II → 4; serviço →
 * pelo anexo de serviço da empresa). Retorna as atividades e o total interno.
 */
function atividadesEstabelecimento(
    comercio: number,
    industria: number,
    servico: number,
    empresa: SimplesNacionalEmpresa,
    fatorR: number,
): { atividades: AtividadePgdas[]; totalInterno: number; exigeFolha: boolean } {
    const grupos = new Map<number, AtividadePgdas>();
    let totalInterno = 0;
    let exigeFolha = false;
    const c = round2(comercio || 0);
    const i = round2(industria || 0);
    const s = round2(servico || 0);
    if (c > 0) { addAtividade(grupos, 1, c); totalInterno = round2(totalInterno + c); }
    if (i > 0) { addAtividade(grupos, 4, i); totalInterno = round2(totalInterno + i); }
    if (s > 0) {
        if (anexoExigeFolhaSalario(empresa.anexo)) exigeFolha = true;
        const idAtividade = idAtividadePgdas(
            serviceFallbackAnexo(empresa),
            { issRetido: true, icmsSt: false, isSup: false, isMonofasico: false, isExterior: false },
            fatorR,
        );
        addAtividade(grupos, idAtividade, s);
        totalInterno = round2(totalInterno + s);
    }
    return { atividades: Array.from(grupos.values()), totalInterno, exigeFolha };
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

function montarFolhasSalario(
    empresa: SimplesNacionalEmpresa,
    pa: number,
    exigeFolhaSalario: boolean,
): Array<{ pa: number; valor: number }> {
    if (!exigeFolhaSalario) return [];

    const pasAnteriores = new Set<number>();
    for (let i = 1; i <= 12; i++) pasAnteriores.add(paAnterior(pa, i));

    const folhasMensais = Object.entries(empresa.folhaMensal || {})
        .map(([competenciaFolha, valor]) => {
            const match = competenciaFolha.match(/^(\d{4})-(\d{2})$/);
            if (!match) return null;
            return {
                pa: Number(`${match[1]}${match[2]}`),
                valor: round2(Number(valor) || 0),
            };
        })
        .filter((item): item is { pa: number; valor: number } =>
            !!item && item.valor > 0 && pasAnteriores.has(item.pa)
        )
        .sort((a, b) => a.pa - b.pa);

    if (folhasMensais.length > 0) return folhasMensais;

    const folha12Legada = round2(empresa.folha12 || 0);
    if (folha12Legada > 0) {
        return [{ pa: paAnterior(pa, 1), valor: folha12Legada }];
    }

    return [];
}

/**
 * Atividades de SERVIÇO cujo id JÁ significa "ISS retido pelo tomador"
 * (Anexo III=15, V=12, IV=18). Nelas a retenção está declarada pelo próprio
 * id — mandar TAMBÉM a qualificação tributária de ISS retido é declaração em
 * dobro e o SERPRO recusa a entrega inteira:
 *   MSG_ISN_032 "Qualificação tributária inválida: Retenção de ISS não é
 *   permitida para o idAtividade 15 com o tributo ISS" (caso S&P, 03/08/2026).
 * Nas atividades de exterior (29/30/31) não há ISS a reter (exportação).
 */
const ATIVIDADES_COM_ISS_RETIDO_NO_ID = new Set([12, 15, 18]);
const ATIVIDADES_EXTERIOR = new Set([3, 6, 29, 30, 31]);

function montarReceitaAtividade(
    state: Pick<CnaeInputState, 'issRetido' | 'icmsSt' | 'isMonofasico'>,
    valor: number,
    idAtividade: number,
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
    if (state.issRetido
        && !ATIVIDADES_COM_ISS_RETIDO_NO_ID.has(idAtividade)
        && !ATIVIDADES_EXTERIOR.has(idAtividade)) {
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
    let exigeFolhaSalario = false;

    Object.entries(faturamentoPorCnae).forEach(([key, state]) => {
        const valor = round2(parseValorBr(state.valor));
        if (valor <= 0) return;
        const anexo = anexoFromKey(key, empresa.anexo);
        const idAtividade = idAtividadePgdas(anexo, state, resumo.fator_r || 0);
        if (anexoExigeFolhaSalario(anexo)) exigeFolhaSalario = true;
        addAtividade(grupos, idAtividade, valor, montarReceitaAtividade(state, valor, idAtividade));
        if (state.isExterior) totalExterno = round2(totalExterno + valor);
        else totalInterno = round2(totalInterno + valor);
    });

    // NOVO modelo (opção B): cada filial é um estabelecimento próprio, com CNPJ
    // e atividades próprias — igual ao e-CAC. Ativa quando há filiaisReceita com
    // receita > 0. Nesse caso os buckets consolidados legados são IGNORADOS.
    const filiaisComReceita = (input.filiaisReceita || [])
        .map((f) => ({
            cnpj: soDigitos(f.cnpj),
            comercio: round2(f.comercio || 0),
            industria: round2(f.industria || 0),
            servico: round2(f.servico || 0),
        }))
        .filter((f) => f.cnpj.length === 14
            && f.cnpj !== cnpjLimpo
            && (f.comercio + f.industria + f.servico) > 0);

    const usarPerFilial = filiaisComReceita.length > 0;

    // LEGADO: buckets consolidados jogados na matriz. Só quando NÃO há filiais
    // declaradas por estabelecimento (evita dupla contagem).
    if (!usarPerFilial) {
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
            if (anexoExigeFolhaSalario(empresa.anexo)) exigeFolhaSalario = true;
            const idAtividade = idAtividadePgdas(
                serviceFallbackAnexo(empresa),
                { issRetido: true, icmsSt: false, isSup: false, isMonofasico: false, isExterior: false },
                resumo.fator_r || 0,
            );
            addAtividade(grupos, idAtividade, filialServicoSafe);
            totalInterno = round2(totalInterno + filialServicoSafe);
        }
    }

    const atividadesMatriz = Array.from(grupos.values())
        .sort((a, b) => a.idAtividade - b.idAtividade);

    const estabelecimentos: PgdasPayload['declaracao']['estabelecimentos'] = [{
        cnpjCompleto: cnpjLimpo,
        atividades: atividadesMatriz,
    }];

    // Um estabelecimento por filial com receita própria.
    filiaisComReceita.forEach((f) => {
        const res = atividadesEstabelecimento(
            f.comercio, f.industria, f.servico, empresa, resumo.fator_r || 0,
        );
        if (res.exigeFolha) exigeFolhaSalario = true;
        totalInterno = round2(totalInterno + res.totalInterno);
        estabelecimentos.push({
            cnpjCompleto: f.cnpj,
            atividades: res.atividades.sort((a, b) => a.idAtividade - b.idAtividade),
        });
    });

    // Histórico de receitas anteriores aceito pelo PGDAS-D. Para empresa em
    // início de atividade, não envie meses anteriores à abertura/opção: o SERPRO
    // rejeita com MSG_ISN_048 ("período desnecessário").
    const fatManual = empresa.faturamentoManual || {};
    const receitasBrutasAnteriores: PgdasPayload['declaracao']['receitasBrutasAnteriores'] = [];
    const mesesReceitasAnteriores = quantidadeMesesReceitasAnteriores(empresa, resumo, pa);
    for (let i = 1; i <= mesesReceitasAnteriores; i++) {
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
        estabelecimentos,
    };

    const folhasSalario = montarFolhasSalario(empresa, pa, exigeFolhaSalario);
    if (folhasSalario.length > 0) {
        declaracao.folhasSalario = folhasSalario;
    }

    return {
        declaracao,
        _competencia: competencia,
        _cnpjLimpo: cnpjLimpo,
        _avisos: avisosDoPayload(faturamentoPorCnae),
        _bloqueios: bloqueiosDoPayload(faturamentoPorCnae),
        // O backend revalida a trava do SUP contra o banco — não confia na
        // lista de bloqueios que veio do navegador (pode estar desatualizada).
        _temSup: Object.values(faturamentoPorCnae || {})
            .some((s) => s && s.isSup && round2(parseValorBr(s.valor)) > 0),
    };
}

/**
 * Marcações que REDUZEM o DAS no cálculo do app mas que este mapper ainda NÃO
 * traduz para o PGDAS-D — o SERPRO recalcula a declaração sem elas e cobra mais
 * do que a tela mostrou. Farol honesto: em vez de transmitir calado, a tela
 * avisa antes de emitir (caso S&P: benefício do ISS(SUP), 03/08/2026).
 * Os campos `_*` são meta do app; o backend só envia `declaracao` ao SERPRO.
 */
/**
 * BLOQUEIOS: motivos pelos quais a declaração NÃO pode ser transmitida como
 * está. Diferente do aviso (que informa e deixa seguir), aqui o app se recusa —
 * entrega ao PGDAS-D não se desfaz, e declarar natureza errada é pior do que
 * não declarar pelo app (Paulo, 03/08: "leva errado pro SIMPLES").
 */
export function bloqueiosDoPayload(faturamentoPorCnae: Record<string, CnaeInputState>): string[] {
    const bloqueios: string[] = [];
    const comValor = Object.values(faturamentoPorCnae || {})
        .filter((s) => s && round2(parseValorBr(s.valor)) > 0);

    if (comValor.some((s) => s.isSup) && idAtividadeIssFixoCadastrado === null) {
        bloqueios.push(
            'Receita marcada como ISS fixo (SUP): a atividade correta é "Escritórios de serviços '
            + 'contábeis autorizados pela legislação municipal a pagar o ISS em valor fixo em guia '
            + 'do Município", e o código oficial dela ainda não está cadastrado no app. Transmitir '
            + 'agora declararia "ISS retido pelo tomador" — valor certo, natureza errada. '
            + 'O que fazer: use o botão "🔎 Atividades declaradas" numa competência já declarada '
            + 'para descobrir o número e cadastre-o ali mesmo (só admin); enquanto isso, entregue '
            + 'esta competência direto no e-CAC.',
        );
    }
    return bloqueios;
}

export function avisosDoPayload(faturamentoPorCnae: Record<string, CnaeInputState>): string[] {
    const avisos: string[] = [];
    const comValor = Object.values(faturamentoPorCnae || {})
        .filter((s) => s && round2(parseValorBr(s.valor)) > 0);


    if (comValor.some((s) => s.isImune)) {
        avisos.push(
            'Há receita marcada como IMUNE: o app tira ICMS/IPI do DAS, mas a declaração '
            + 'ainda não envia a qualificação de imunidade — confira o DAS calculado pela Receita.',
        );
    }
    return avisos;
}
