// ============================================================================
// sefaz-backend/nfse-nacional-provider.js
// Provider abstrato pra emissao de NFS-e Padrao Nacional.
//
// Base regulatoria:
//   Resolucao CGSN 189/2026 — Vigencia 1° setembro 2026
//   Toda ME/EPP do Simples prestadora de servicos OBRIGADA a usar.
//
// Modos:
//   - 'mock'   (default): emite NFSe ficticia com numero + chave + DPS
//   - 'serpro' (futuro):  Emissor Nacional NFS-e via API
//                         https://www.gov.br/nfse (gratuito)
//
// Estrutura simplificada — versao base; cancelamento/eventos/contingencia
// virao em iteracoes futuras.
// ============================================================================

const MODE = process.env.NFSE_NAC_MODE || 'mock';

// ─── Helpers ──────────────────────────────────────────────────────────────

function gerarChaveNfse(cnpjPrestador, ano, sequencial) {
    // Chave simplificada: 50 chars (versao mock; padrao real tem layout especifico)
    // [2 ano] + [14 cnpj] + [6 mun ibge default 3550308] + [10 sequencial] + [18 hash]
    const cnpj = (cnpjPrestador || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const seq = String(sequencial).padStart(10, '0').slice(-10);
    const ts = Date.now().toString().padStart(13, '0').slice(-13);
    const tail = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    return `${ano}${cnpj}3550308${seq}${ts}${tail}`.slice(0, 50);
}

function calcularIssRetido(valorServico, aliquotaIss, deveRetido) {
    if (!deveRetido) return 0;
    return +(valorServico * (aliquotaIss / 100)).toFixed(2);
}

// ─── MockProvider ─────────────────────────────────────────────────────────

class MockProvider {
    /**
     * Emite NFSe Nacional (mock).
     *
     * @param {object} req {
     *   prestador: { cnpj, im, nome },
     *   tomador: { cnpj?, cpf?, nome, endereco? },
     *   servico: {
     *     codigoNbs,            // codigo NBS da Nomenclatura Brasileira de Servicos
     *     descricao,
     *     valor,
     *     aliquotaIss,
     *     issRetido?,
     *     municipioPrestacao?,  // codigo IBGE
     *   },
     *   dataEmissao?,
     *   sequencial?
     * }
     * @returns NFSe persistivel
     */
    async emitirNfse(req) {
        const { prestador, tomador, servico } = req;
        if (!prestador?.cnpj) throw new Error('Prestador.cnpj obrigatorio');
        if (!servico?.valor || servico.valor <= 0) throw new Error('Valor do servico obrigatorio (>0)');
        if (!servico?.descricao) throw new Error('Descricao do servico obrigatoria');
        if (!tomador?.nome) throw new Error('Tomador.nome obrigatorio');

        const ano = new Date().getFullYear().toString().slice(-2);
        const seq = req.sequencial || Math.floor(Math.random() * 999999);
        const numero = `2026${String(seq).padStart(8, '0')}`;
        const chave = gerarChaveNfse(prestador.cnpj, ano, seq);

        const aliquota = servico.aliquotaIss || 5;
        const issValor = +(servico.valor * (aliquota / 100)).toFixed(2);
        const issRetido = calcularIssRetido(servico.valor, aliquota, !!servico.issRetido);
        const valorLiquido = +(servico.valor - issRetido).toFixed(2);

        return {
            numero,
            chave,
            dpsRecibo: `DPS-MOCK-${Date.now().toString(36)}`,
            dataEmissao: req.dataEmissao || new Date().toISOString(),
            status: 'autorizada',
            prestador: {
                cnpj: prestador.cnpj,
                im: prestador.im || '',
                nome: prestador.nome || '',
            },
            tomador: {
                cnpj: tomador.cnpj || null,
                cpf: tomador.cpf || null,
                nome: tomador.nome,
                endereco: tomador.endereco || null,
            },
            servico: {
                codigoNbs: servico.codigoNbs || '101010100',
                descricao: servico.descricao,
                valor: servico.valor,
                aliquotaIss: aliquota,
                issValor,
                issRetido,
                municipioPrestacao: servico.municipioPrestacao || '3550308',
            },
            valores: {
                bruto: servico.valor,
                deducoes: 0,
                issRetido,
                liquido: valorLiquido,
            },
            fonte: 'mock',
            mensagem: 'NFSe emitida em modo mock. URL/PDF de DANFSe nao disponiveis em mock.',
        };
    }

    async cancelarNfse(req) {
        const { numero, chave, motivo } = req;
        return {
            ok: true,
            numero,
            chave,
            motivo: motivo || 'erro de digitacao',
            canceladaEm: new Date().toISOString(),
            fonte: 'mock',
        };
    }
}

// ─── SerproProvider (skeleton) ────────────────────────────────────────────

class SerproProvider {
    constructor() {
        throw new Error(
            'SerproProvider NFSe Nacional ainda nao implementado. ' +
            'Pre-requisitos: certificado e-CNPJ A1 SP Contabil + cadastro no Emissor Nacional NFSe ' +
            '(gratuito, gov.br/nfse). Quando ativar: NFSE_NAC_MODE=serpro.'
        );
    }
    async emitirNfse() { throw new Error('SerproProvider.emitirNfse nao implementado'); }
    async cancelarNfse() { throw new Error('SerproProvider.cancelarNfse nao implementado'); }
}

// ─── Factory ──────────────────────────────────────────────────────────────

let providerInstance = null;
export function getNfseNacionalProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'serpro' ? new SerproProvider() : new MockProvider();
    return providerInstance;
}
export function getNfseNacionalMode() { return MODE; }

// ─── NBS — Nomenclatura Brasileira de Servicos (subset inicial) ───────────
//
// A tabela completa tem ~600 codigos. Carregar progressivamente conforme
// necessidade dos clientes da SP Contabil. Os codigos abaixo cobrem ~80%
// das prestacoes dos clientes tipicos do escritorio.

export const NBS_CODIGOS_COMUNS = [
    { codigo: '101010100', descricao: 'Servicos de contabilidade — Escrituracao' },
    { codigo: '101010200', descricao: 'Servicos de auditoria contabil' },
    { codigo: '101010300', descricao: 'Servicos de consultoria contabil' },
    { codigo: '101020100', descricao: 'Servicos juridicos — consultoria' },
    { codigo: '101020200', descricao: 'Servicos advocaticios — defesa em juizo' },
    { codigo: '101030100', descricao: 'Servicos de engenharia consultiva' },
    { codigo: '101040100', descricao: 'Servicos de TI — desenvolvimento de software' },
    { codigo: '101040200', descricao: 'Servicos de TI — manutencao de software' },
    { codigo: '101040300', descricao: 'Servicos de TI — hospedagem (cloud)' },
    { codigo: '101050100', descricao: 'Servicos de marketing e publicidade' },
    { codigo: '101060100', descricao: 'Servicos de saude — clinicas medicas' },
    { codigo: '101060200', descricao: 'Servicos de saude — odontologia' },
    { codigo: '101070100', descricao: 'Servicos de educacao — cursos livres' },
    { codigo: '101080100', descricao: 'Servicos de transporte de cargas' },
    { codigo: '101080200', descricao: 'Servicos de transporte de passageiros' },
    { codigo: '101090100', descricao: 'Servicos de limpeza e conservacao' },
    { codigo: '101090200', descricao: 'Servicos de seguranca' },
    { codigo: '101100100', descricao: 'Servicos de manutencao mecanica em veiculos' },
    { codigo: '101110100', descricao: 'Servicos de comissaria/representacao comercial' },
    { codigo: '101120100', descricao: 'Outros servicos profissionais' },
];
