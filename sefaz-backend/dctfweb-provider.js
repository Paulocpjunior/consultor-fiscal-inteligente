// ============================================================================
// sefaz-backend/dctfweb-provider.js
// Provider DCTFWeb — mock + SERPRO Integra Contador (idSistema=DCTFWEB).
//
// idServicos:
//   TRANSDECLARACAO11           (/Declarar)  transmite declaracao em andamento
//   GERARDOCUMENTOARRECADACAO12 (/Emitir)    gera DARF unificado
//   CONSDECCOMPLETA33           (/Consultar) declaracao ATIVA (PDF)
//   CONSRECIBO32                (/Consultar) recibo de transmissao (PDF)
//   CONSXMLDECLARACAO           (/Consultar) XML
//   GERARDARFANDAMENTO          (/Emitir)    DARF p/ declaracao em andamento
//   ENCERRARAPURACAOMIT         (/Declarar)  encerra MIT
//   CONSITUAENCERRAMENTOMIT     (/Consultar) status encerramento MIT
//   CONSAPURACAOMIT             (/Consultar) detalhes apuracao MIT
//   CONSAPURACAOPORANO          (/Consultar) historico anual MIT
//
// Custo SERPRO: ~R$ 0,75 por TRANSDEC/GERARDARF; demais ~R$ 0,06-0,40.
// Troca via env DCTFWEB_MODE — sem rebuild.
// ============================================================================

import { invokeIntegraContador } from './serpro-client.js';

// Default 'serpro' (REAL). 'mock' só com DCTFWEB_MODE=mock explícito (dev local).
// Sem config, falha no SERPRO em vez de devolver dado fake pro cliente.
const MODE = process.env.DCTFWEB_MODE || 'serpro';

// Codigos oficiais das categorias DCTFWeb (manual RFB 2024 + IN RFB 2.005/2021):
//   13 = Geral Mensal (categoria principal — contribuicoes previdenciarias mensais)
//   14 = 13º Salário Geral
//   50 = Aferição de Obra
//   51 = Espetáculo Desportivo
//   52 = Reclamatória Trabalhista
//   60 = MIT (Modulo de Inclusao de Tributos — mensal, para tributos proprios)
export const DCTFWEB_CATEGORIAS = {
    GERAL_MENSAL: 13,
    GERAL_13: 14,
    AFERICAO: 50,
    ESPETACULO: 51,
    RECLAMATORIA: 52,
    MIT: 60,
};

function safeJsonParse(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return s; }
}

function hashCnpj(cnpj) {
    let h = 0;
    for (const c of String(cnpj || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
}

class MockProvider {
    async listarDeclaracoes(empresaCnpj, { anoPA, mesPA } = {}) {
        const seed = hashCnpj(empresaCnpj);
        const ano = anoPA || new Date().getFullYear();
        const mes = mesPA || (new Date().getMonth() + 1);
        return [{
            id: `${empresaCnpj}_${ano}${String(mes).padStart(2,'0')}_GERAL_MENSAL`,
            empresaCnpj,
            categoria: 'GERAL_MENSAL',
            categoriaCodigo: DCTFWEB_CATEGORIAS.GERAL_MENSAL,
            anoPA: ano,
            mesPA: mes,
            situacao: (seed % 3 === 0) ? 'ATIVA' : 'EM_ANDAMENTO',
            valorTotal: 1000 + (seed % 5000),
            inssRetido: 500 + (seed % 2000),
            cprbDevido: (seed % 7 === 0) ? 200 + (seed % 300) : 0,
            dataVencimento: `${mes + 1 > 12 ? ano + 1 : ano}-${String(mes + 1 > 12 ? 1 : mes + 1).padStart(2,'0')}-15`,
            numeroRecibo: (seed % 3 === 0) ? `${ano}${mes}.${(seed % 99999).toString().padStart(5,'0')}` : '',
            transmitidoEm: (seed % 3 === 0) ? `${ano}-${String(mes).padStart(2,'0')}-10T15:00:00-03:00` : null,
            fonte: 'mock',
        }];
    }

    async transmitirDeclaracao({ empresaCnpj, anoPA, mesPA, categoria }) {
        const seed = hashCnpj(empresaCnpj);
        return {
            categoria,
            numeroRecibo: `${anoPA}${mesPA}.${(seed % 99999).toString().padStart(5,'0')}`,
            transmitidoEm: new Date().toISOString(),
            situacao: 'ATIVA',
            mensagem: 'Mock: transmitida.',
            fonte: 'mock',
        };
    }

    async gerarDarf({ empresaCnpj, anoPA, mesPA, categoria }) {
        const seed = hashCnpj(empresaCnpj);
        // Vencimento DARF dia 20 do mês seguinte ao da competência (Lei 8.212/91
        // art. 30). Usa Date object pra tratar virada de ano (mesPA=12 → ano+1, mes=1).
        const dtVcto = new Date(Date.UTC(anoPA, mesPA, 20)); // mesPA é 1-12; new Date com mes 0-11, então mesPA já avança
        const vencimento = dtVcto.toISOString().slice(0, 10);
        return {
            valor: 500 + (seed % 5000),
            numeroDocumento: `${anoPA}${mesPA}${(seed % 99999).toString().padStart(5,'0')}`,
            codigoBarras: '85820000000-0 02261202602-3 50000044388-1 521234567890',
            vencimento,
            pdfBase64: '',
            mensagem: 'Mock: DARF gerado.',
            fonte: 'mock',
        };
    }

    async consultarDeclaracaoCompleta({ categoria, anoPA, mesPA }) {
        return { pdfBase64: '', categoria, anoPA, mesPA, fonte: 'mock' };
    }

    async consultarRecibo({ categoria, anoPA, mesPA }) {
        return { pdfBase64: '', categoria, anoPA, mesPA, fonte: 'mock' };
    }

    async encerrarApuracaoMit() {
        return { statusEncerramento: 'PROCESSANDO', protocolo: `MIT-${Date.now()}`, fonte: 'mock' };
    }

    async consultarStatusEncerramentoMit({ protocolo }) {
        return { statusEncerramento: 'ENCERRADA', protocolo, fonte: 'mock' };
    }

    async consultarApuracaoMit() {
        return { apuracaoMit: { tributos: [], total: 0 }, fonte: 'mock' };
    }

    async consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' } = {}) {
        const seed = hashCnpj(empresaCnpj);
        const inss = (500 + (seed % 2000)).toFixed(2).replace('.', ',');
        // XML minimo no shape DCTFWeb (Geral Mensal) com retencao previdenciaria.
        const xml = `<?xml version="1.0" encoding="UTF-8"?>`
            + `<dctfweb><identificacao><categoria>${categoria}</categoria>`
            + `<anoPA>${anoPA}</anoPA><mesPA>${mesPA}</mesPA></identificacao>`
            + `<apuracao><retencoes><vlrTotalRetPrinc>${inss}</vlrTotalRetPrinc>`
            + `<vlrTotalRetAdic>0,00</vlrTotalRetAdic></retencoes></apuracao></dctfweb>`;
        return { xml, categoria, anoPA, mesPA, fonte: 'mock' };
    }

    async consultarApuracoesAno({ anoPA }) {
        return { ano: anoPA, apuracoes: [], fonte: 'mock' };
    }
}


class SerproProvider {
    constructor() {}

    async listarDeclaracoes(empresaCnpj, { anoPA, mesPA, categoria } = {}) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const ano = anoPA || new Date().getFullYear();
        const mes = mesPA || (new Date().getMonth() + 1);
        const cat = categoria || 'GERAL_MENSAL';
        try {
            const r = await invokeIntegraContador({
                idSistema: 'DCTFWEB',
                idServico: 'CONSDECCOMPLETA33',
                contribuinteCnpj: cnpj,
                acao: 'Consultar',
                dados: { categoria: cat, anoPA: String(ano), mesPA: String(mes).padStart(2,'0') },
            });
            const d = safeJsonParse(r.dados) || {};
            const temPdf = !!d.PDFByteArrayBase64;
            return [{
                id: `${cnpj}_${ano}${String(mes).padStart(2,'0')}_${cat}`,
                empresaCnpj: cnpj,
                categoria: cat,
                categoriaCodigo: DCTFWEB_CATEGORIAS[cat] || 0,
                anoPA: ano,
                mesPA: mes,
                situacao: temPdf ? 'ATIVA' : 'EM_ANDAMENTO',
                fonte: 'serpro',
            }];
        } catch (err) {
            return [{
                id: `${cnpj}_${ano}${String(mes).padStart(2,'0')}_${cat}`,
                empresaCnpj: cnpj,
                categoria: cat,
                categoriaCodigo: DCTFWEB_CATEGORIAS[cat] || 0,
                anoPA: ano,
                mesPA: mes,
                situacao: 'EM_ANDAMENTO',
                _erro: err.message,
                fonte: 'serpro',
            }];
        }
    }

    async transmitirDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'TRANSDECLARACAO11',
            contribuinteCnpj: cnpj,
            acao: 'Declarar',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return {
            _raw: d,
            categoria,
            numeroRecibo: d.numeroRecibo || d.recibo || '',
            transmitidoEm: d.dataHoraTransmissao || new Date().toISOString(),
            situacao: 'ATIVA',
            fonte: 'serpro',
        };
    }

    async gerarDarf({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL', emAndamento = false }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const idServico = emAndamento ? 'GERARDARFANDAMENTO' : 'GERARDOCUMENTOARRECADACAO12';
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico,
            contribuinteCnpj: cnpj,
            acao: 'Emitir',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return {
            _raw: d,
            valor: parseFloat(d.valor || d.valorTotal || '0'),
            numeroDocumento: d.numeroDocumento || d.numeroDarf || '',
            codigoBarras: d.codigoBarras || d.linhaDigitavel || '',
            vencimento: d.dataVencimento || d.vencimento || '',
            pdfBase64: d.PDFByteArrayBase64 || d.pdfBase64 || '',
            fonte: 'serpro',
        };
    }

    async consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSDECCOMPLETA33',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return { pdfBase64: d.PDFByteArrayBase64 || '', categoria, anoPA, mesPA, fonte: 'serpro' };
    }

    async consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria = 40 }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const catCode = typeof categoria === 'number' ? categoria : (DCTFWEB_CATEGORIAS[categoria] || DCTFWEB_CATEGORIAS.GERAL_MENSAL);
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSRECIBO32',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria: catCode, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return { pdfBase64: d.PDFByteArrayBase64 || '', categoria: catCode, anoPA, mesPA, fonte: 'serpro' };
    }

    async encerrarApuracaoMit({ empresaCnpj, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'ENCERRARAPURACAOMIT',
            contribuinteCnpj: cnpj,
            acao: 'Declarar',
            dados: { anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return { _raw: d, statusEncerramento: d.status || 'PROCESSANDO', protocolo: d.protocolo || '', fonte: 'serpro' };
    }

    async consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSITUAENCERRAMENTOMIT',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: protocolo ? { protocolo } : { anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return { _raw: d, statusEncerramento: d.status || 'DESCONHECIDO', protocolo: d.protocolo || protocolo, fonte: 'serpro' };
    }

    async consultarApuracaoMit({ empresaCnpj, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSAPURACAOMIT',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = safeJsonParse(r.dados) || {};
        return { apuracaoMit: d.apuracao || d, fonte: 'serpro' };
    }

    async consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSXMLDECLARACAO',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2, '0') },
        });
        const d = safeJsonParse(r.dados) || {};
        // SERPRO pode devolver o XML cru (string) OU base64 (XMLByteArrayBase64).
        let xml = d.xml || d.XMLDeclaracao || d.declaracaoXml || '';
        const b64 = d.XMLByteArrayBase64 || d.xmlBase64;
        if (!xml && b64) {
            try { xml = Buffer.from(b64, 'base64').toString('utf8'); } catch { xml = ''; }
        }
        return { xml, _raw: d, categoria, anoPA, mesPA, fonte: 'serpro' };
    }

    async consultarApuracoesAno({ empresaCnpj, anoPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSAPURACAOPORANO',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { anoPA: String(anoPA) },
        });
        const d = safeJsonParse(r.dados) || {};
        return { ano: anoPA, apuracoes: d.apuracoes || [], fonte: 'serpro' };
    }
}


let providerInstance = null;
export function getDctfwebProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = (MODE === 'serpro') ? new SerproProvider() : new MockProvider();
    return providerInstance;
}

export function getDctfwebMode() { return MODE; }
