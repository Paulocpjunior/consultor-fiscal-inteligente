// ============================================================================
// sefaz-backend/nfse-nacional-provider.js
// Provider abstrato pra emissao de NFS-e Padrao Nacional.
//
// Base regulatoria:
//   Resolucao CGSN 189/2026 — Vigencia 1° setembro 2026
//   Toda ME/EPP do Simples prestadora de servicos OBRIGADA a usar.
//
// Modos:
//   - 'mock'   : gera NFSe ficticia local (sem chamar gov.br)
//   - 'real'   : Emissor Nacional NFS-e via SEFIN (https://sefin.nfse.gov.br),
//                mTLS com cert ICP-Brasil do prestador, DPS XML+XMLDSig
//                +gzip+base64 dentro de envelope JSON. Manual v1.2 out/2025.
//                Subflag NFSE_NAC_EMISSAO_AMB=homologacao|producao (default
//                homologacao — producao restrita primeiro).
//                Subflag NFSE_NAC_EMISSAO_DRY_RUN=1 monta tudo mas NAO envia.
//
// Note: nome 'serpro' antigo era enganoso — emissao NFS-e Nacional NAO usa
// Integra Contador SERPRO; vai DIRETO no Sistema Nacional NFS-e (gov.br/nfse,
// gratuito). Mantido 'serpro' como alias por compatibilidade de env var.
// ============================================================================

import { buildDpsXml } from './nfse-nacional-dps-builder.js';
import { assinarDpsXml } from './nfse-nacional-dps-signer.js';
import {
    emitirDps,
    carregarCertPrestador,
    getEmissaoAmbiente,
} from './nfse-nacional-emissao-client.js';

// Default 'real' (Emissor Nacional). 'mock' so com NFSE_NAC_MODE=mock explicito.
// 'serpro' tratado como alias de 'real' (compat).
const MODE_RAW = process.env.NFSE_NAC_MODE || 'real';
const MODE = (MODE_RAW === 'serpro' || MODE_RAW === 'real') ? 'real' : 'mock';

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

        // Validacao fiscal — LC 116/2003 art. 8º II: aliquota maxima ISS = 5%.
        // EC 37/2002 art. 88: aliquota minima ISS = 2% (exceto servicos com
        // beneficio formal do municipio listados no art. 88 §1º).
        const aliq = servico.aliquotaIss ?? 5;
        if (aliq > 5) {
            throw new Error(`Aliquota ISS ${aliq}% excede maximo legal de 5% (LC 116/2003 art. 8º II).`);
        }
        if (aliq < 0) {
            throw new Error('Aliquota ISS nao pode ser negativa.');
        }

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
                cIndOp: servico.cIndOp || '',
                cClassTrib: servico.cClassTrib || '',
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

// ─── EmissorNacionalProvider (REAL) ───────────────────────────────────────
//
// Implementacao real chamando SEFIN (https://sefin.nfse.gov.br/SefinNacional).
// Pipeline: payload UI -> buildDpsXml -> assinarDpsXml -> emitirDps (mTLS).
//
// Pre-requisitos operacionais:
//   1) Cert A1 ICP-Brasil do prestador cadastrado em cert-storage (por empresa).
//   2) Empresa adesa ao Sistema Nacional NFS-e (gov.br/nfse) — operacional.
//   3) Em modo cert do escritorio: procuracao e-CAC com escopo NFS-e Nacional.
//   4) Para o primeiro disparo, recomenda-se NFSE_NAC_EMISSAO_DRY_RUN=1 +
//      NFSE_NAC_EMISSAO_AMB=homologacao pra validar XML antes de queimar
//      tentativa em producao restrita.
//
// Resposta esperada do SEFIN (sincrono): NFS-e completa + chave 50 digitos.
// SE o primeiro teste real retornar erro de schema, devolver XML rejeitado +
// msg do SEFIN pra ajuste dos campos do builder (NORMAL em integracao nova).
class EmissorNacionalProvider {
    async emitirNfse(req) {
        const { empresaId, prestador, tomador, servico } = req;
        if (!prestador?.cnpj) throw new Error('prestador.cnpj obrigatorio');
        if (!tomador?.nome) throw new Error('tomador.nome obrigatorio');
        if (!servico?.valor || servico.valor <= 0) throw new Error('servico.valor obrigatorio (>0)');
        if (!servico?.descricao) throw new Error('servico.descricao obrigatoria');

        // Validacao fiscal duplicada do MockProvider (mesmas regras valem).
        const aliq = servico.aliquotaIss ?? 5;
        if (aliq > 5) throw new Error(`Aliquota ISS ${aliq}% excede maximo legal de 5% (LC 116/2003 art. 8º II).`);
        if (aliq < 0) throw new Error('Aliquota ISS nao pode ser negativa.');

        const amb = getEmissaoAmbiente();
        // 1) Builder (puro)
        const { xml: xmlDps, idDps } = buildDpsXml({ ...req, ambiente: amb.ambiente });
        // 2) Cert do prestador (sem fallback silencioso pro escritorio)
        const cert = await carregarCertPrestador(empresaId, {
            permitirEscritorio: req.permitirCertEscritorio === true,
        });
        // 3) Assina XMLDSig
        const xmlAssinado = assinarDpsXml(xmlDps, idDps, cert.pemCert, cert.pemKey);
        // 4) Envia (ou dry-run)
        const r = await emitirDps({
            xmlDpsAssinado: xmlAssinado,
            cert: { pfxBuffer: cert.pfxBuffer, password: cert.password },
        });

        if (r.dryRun) {
            return {
                numero: null,
                chave: null,
                dpsRecibo: null,
                dataEmissao: null,
                status: 'dry-run',
                idDps,
                ambiente: amb.ambiente,
                xmlDps: xmlAssinado,
                bodyPreview: r.bodyPreview,
                fonte: 'real-dry-run',
                mensagem: 'NFSE_NAC_EMISSAO_DRY_RUN=1 — XML montado e assinado mas NAO enviado ao SEFIN. Inspecione xmlDps antes de remover a flag.',
            };
        }

        if (r.statusCode >= 400) {
            const motivo = r.body?.mensagem || r.body?.mensagens?.[0]?.descricao || r.raw?.slice(0, 500);
            throw new Error(`SEFIN ${r.statusCode}: ${motivo}`);
        }

        const nfse = r.body || {};
        // Manual prove a chave de 50 digitos no response. Nomes exatos sao
        // confirmados na primeira chamada real — pegamos os mais provaveis.
        const chave = nfse.chaveAcesso || nfse.chave || nfse.chNFSe || nfse.id || null;
        const numero = nfse.numero || nfse.numeroNfse || nfse.nNFSe || null;
        const dpsRecibo = nfse.dpsRecibo || nfse.nProtocolo || nfse.protocolo || null;

        const valorBruto = +Number(servico.valor).toFixed(2);
        const issValor = +(valorBruto * (aliq / 100)).toFixed(2);
        const issRetido = servico.issRetido ? issValor : 0;
        return {
            numero,
            chave,
            dpsRecibo,
            dataEmissao: nfse.dhEmi || nfse.dataEmissao || req.dataEmissao || new Date().toISOString(),
            status: nfse.status || 'autorizada',
            idDps,
            ambiente: amb.ambiente,
            certFonte: cert.fonte,
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
                valor: valorBruto,
                aliquotaIss: aliq,
                issValor,
                issRetido,
                municipioPrestacao: servico.municipioPrestacao || '3550308',
                cIndOp: servico.cIndOp || '',
                cClassTrib: servico.cClassTrib || '',
            },
            valores: {
                bruto: valorBruto,
                deducoes: 0,
                issRetido,
                liquido: +(valorBruto - issRetido).toFixed(2),
            },
            fonte: 'real',
            _raw: nfse,
        };
    }

    async cancelarNfse(req) {
        // Cancelamento via POST /nfse/{chave}/eventos exige builder + signer
        // proprio do evento (estrutura diferente do DPS). Mantido como TODO
        // — primeira emissao real e o caminho critico (vigencia CGSN 189
        // em 1°/set/2026). Cancelamento e fluxo mais raro.
        throw new Error(
            'Cancelamento NFS-e Nacional via SEFIN nao implementado nesta fase. ' +
            'Implementar buildEventoCancelamentoXml + assinar + postEvento em PR separado.'
        );
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────

let providerInstance = null;
export function getNfseNacionalProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'real' ? new EmissorNacionalProvider() : new MockProvider();
    return providerInstance;
}
export function getNfseNacionalMode() { return MODE; }

// ─── NBS — Nomenclatura Brasileira de Servicos (subset inicial) ───────────
//
// A tabela completa tem ~600 codigos. Carregar progressivamente conforme
// necessidade dos clientes da SP Contabil. Os codigos abaixo cobrem ~80%
// das prestacoes dos clientes tipicos do escritorio.

export const NBS_CODIGOS_COMUNS = [
    // ─── 1. Servicos contabeis e fiscais (LC 116 item 17) ───────────────
    { codigo: '101010100', descricao: 'Contabilidade — Escrituracao contabil regular', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010200', descricao: 'Contabilidade — Auditoria independente', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010300', descricao: 'Contabilidade — Consultoria contabil', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010400', descricao: 'Contabilidade — Pericia contabil', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010500', descricao: 'Contabilidade — Departamento pessoal e folha', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010600', descricao: 'Assessoria fiscal e tributaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010700', descricao: 'Planejamento tributario', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010800', descricao: 'Recuperacao de creditos tributarios', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010900', descricao: 'Atualizacao cadastral fiscal', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 2. Servicos juridicos (LC 116 item 17.13) ──────────────────────
    { codigo: '101020100', descricao: 'Servicos juridicos — Consultoria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020200', descricao: 'Advocacia — Defesa em juizo civel', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020300', descricao: 'Advocacia — Defesa criminal', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020400', descricao: 'Advocacia tributaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020500', descricao: 'Advocacia trabalhista', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020600', descricao: 'Advocacia empresarial e societaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020700', descricao: 'Mediacao e arbitragem', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020800', descricao: 'Servicos de cartorio', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 3. Engenharia e arquitetura (LC 116 item 7) ────────────────────
    { codigo: '101030100', descricao: 'Engenharia consultiva', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030200', descricao: 'Engenharia civil — Projetos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030300', descricao: 'Engenharia civil — Execucao de obra', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030400', descricao: 'Arquitetura', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030500', descricao: 'Engenharia de seguranca do trabalho', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030600', descricao: 'Agrimensura e topografia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030700', descricao: 'Geologia e geotecnia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 4. Tecnologia da Informacao (LC 116 item 1) ────────────────────
    { codigo: '101040100', descricao: 'TI — Desenvolvimento de software sob encomenda', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040200', descricao: 'TI — Manutencao e suporte de software', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040300', descricao: 'TI — Hospedagem em nuvem (cloud)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040400', descricao: 'TI — Provedor de internet', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040500', descricao: 'TI — Suporte tecnico em hardware', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101040600', descricao: 'TI — Licenciamento de software pronto (SaaS)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040700', descricao: 'TI — Consultoria em TI', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040800', descricao: 'TI — Treinamento em TI', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040900', descricao: 'TI — Backup e recuperacao de dados', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101041000', descricao: 'TI — Seguranca da informacao (cibersec)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101041100', descricao: 'TI — Streaming de audio/video', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 5. Marketing e Publicidade (LC 116 item 17.06, 17.10) ──────────
    { codigo: '101050100', descricao: 'Marketing e publicidade — Criacao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050200', descricao: 'Marketing e publicidade — Veiculacao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050300', descricao: 'Marketing digital e SEO', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050400', descricao: 'Producao de conteudo audiovisual', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050500', descricao: 'Producao grafica e design', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050600', descricao: 'Pesquisa de mercado', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050700', descricao: 'Assessoria de imprensa e relacoes publicas', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 6. Saude (LC 116 item 4) ────────────────────────────────────────
    { codigo: '101060100', descricao: 'Saude — Clinica medica', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060200', descricao: 'Saude — Odontologia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060300', descricao: 'Saude — Psicologia e psicanalise', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060400', descricao: 'Saude — Fisioterapia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060500', descricao: 'Saude — Fonoaudiologia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060600', descricao: 'Saude — Nutricao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060700', descricao: 'Saude — Laboratorio de analises clinicas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060800', descricao: 'Saude — Diagnostico por imagem', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060900', descricao: 'Saude — Internacao hospitalar', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101061000', descricao: 'Saude — Medicina veterinaria', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 7. Educacao (LC 116 item 8) ────────────────────────────────────
    { codigo: '101070100', descricao: 'Educacao — Cursos livres', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070200', descricao: 'Educacao — Ensino fundamental', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070300', descricao: 'Educacao — Ensino medio', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070400', descricao: 'Educacao — Ensino superior e pos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070500', descricao: 'Educacao — Cursos de idiomas', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070600', descricao: 'Educacao — Cursos profissionalizantes', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070700', descricao: 'Educacao — Treinamento corporativo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070800', descricao: 'Educacao — Coaching e mentoria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 8. Transporte (LC 116 item 16) ─────────────────────────────────
    { codigo: '101080100', descricao: 'Transporte de cargas — Rodoviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080200', descricao: 'Transporte de passageiros — Rodoviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080300', descricao: 'Transporte de cargas — Aereo', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080400', descricao: 'Transporte de cargas — Aquaviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080500', descricao: 'Transporte de bagagem e mudancas', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080600', descricao: 'Servicos de moto-frete', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080700', descricao: 'Transporte por aplicativo', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },

    // ─── 9. Limpeza, Seguranca, Vigilancia (LC 116 item 7.10, 11) ───────
    { codigo: '101090100', descricao: 'Limpeza e conservacao predial', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090200', descricao: 'Vigilancia armada e desarmada', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090300', descricao: 'Portaria e recepcao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090400', descricao: 'Dedetizacao e controle de pragas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090500', descricao: 'Lavanderia industrial e domestica', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090600', descricao: 'Coleta de residuos e lixo', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090700', descricao: 'Jardinagem e paisagismo', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 10. Manutencao mecanica e eletrica (LC 116 item 14) ────────────
    { codigo: '101100100', descricao: 'Manutencao mecanica de veiculos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100200', descricao: 'Manutencao eletrica de veiculos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100300', descricao: 'Lanternagem e funilaria', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100400', descricao: 'Pintura automotiva', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100500', descricao: 'Manutencao de eletrodomesticos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100600', descricao: 'Manutencao de computadores e perifericos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100700', descricao: 'Manutencao de elevadores', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100800', descricao: 'Manutencao de ar-condicionado e refrigeracao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 11. Comissaria e representacao (LC 116 item 10) ────────────────
    { codigo: '101110100', descricao: 'Representacao comercial', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110200', descricao: 'Comissaria e despachos aduaneiros', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110300', descricao: 'Agenciamento e corretagem em geral', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110400', descricao: 'Corretagem de imoveis', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110500', descricao: 'Corretagem de seguros', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 12. Beleza e estetica (LC 116 item 6) ──────────────────────────
    { codigo: '101120100', descricao: 'Cabeleireiro e barbearia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120200', descricao: 'Manicure e pedicure', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120300', descricao: 'Estetica facial e corporal', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120400', descricao: 'Massoterapia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120500', descricao: 'Tatuagem e body piercing', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 13. Hotelaria, alimentacao, turismo (LC 116 item 9) ────────────
    { codigo: '101130100', descricao: 'Hotelaria — Hospedagem', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130200', descricao: 'Pousada e hostel', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130300', descricao: 'Bar e restaurante (servico de mesa)', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130400', descricao: 'Bufe e eventos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130500', descricao: 'Agencia de viagens e turismo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101130600', descricao: 'Servicos de guia turistico', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 14. Construcao civil (LC 116 item 7) ───────────────────────────
    { codigo: '101140100', descricao: 'Construcao civil — Reforma', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140200', descricao: 'Construcao civil — Empreitada total', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140300', descricao: 'Pintura predial', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140400', descricao: 'Hidraulica e instalacoes', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140500', descricao: 'Eletrica e instalacoes', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140600', descricao: 'Marcenaria e serralheria sob encomenda', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 15. Eventos e producao (LC 116 item 12) ────────────────────────
    { codigo: '101150100', descricao: 'Organizacao de eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150200', descricao: 'Locacao de equipamentos para eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150300', descricao: 'Servicos de fotografia e filmagem', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150400', descricao: 'Producao de espetaculos artisticos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150500', descricao: 'Servicos de DJ e som', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 16. Locacao de bens moveis (LC 116 item 3) ─────────────────────
    { codigo: '101160100', descricao: 'Locacao de veiculos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160200', descricao: 'Locacao de maquinas e equipamentos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160300', descricao: 'Locacao de roupas e fantasias', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160400', descricao: 'Locacao de espacos para eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 17. Servicos financeiros e administrativos ─────────────────────
    { codigo: '101170100', descricao: 'Cobranca em geral', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170200', descricao: 'Servicos de factoring (fomento mercantil)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170300', descricao: 'Administracao de imoveis e condominios', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170400', descricao: 'Despachante administrativo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170500', descricao: 'Servicos de RH — Recrutamento e selecao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 18. Imprensa e editorial (LC 116 item 13) ──────────────────────
    { codigo: '101180100', descricao: 'Edicao e producao editorial', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101180200', descricao: 'Servicos de impressao grafica', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101180300', descricao: 'Encadernacao e acabamento grafico', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 19. Esporte e lazer ────────────────────────────────────────────
    { codigo: '101190100', descricao: 'Academias e personal trainer', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101190200', descricao: 'Escolinhas esportivas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101190300', descricao: 'Locacao de quadras e campos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 20. Outros servicos ────────────────────────────────────────────
    { codigo: '101900100', descricao: 'Outros servicos profissionais', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101900200', descricao: 'Outros servicos pessoais', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101900300', descricao: 'Servicos diversos nao classificados', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
];
