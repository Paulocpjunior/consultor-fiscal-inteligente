// ============================================================================
// sefaz-backend/nfse-tomada-provider.js
//
// Provider abstrato pra captura de NFSe TOMADAS via API Sefin Nacional / ADN.
//
// Modos:
//   - 'mock'    : retorna 2-3 NFSe ficticias (dev sem cert)
//   - 'restrita': chama https://adn.producaorestrita.nfse.gov.br (homologacao)
//   - 'producao': chama https://adn.nfse.gov.br
//
// Selecao via env var SEFIN_BASE_URL (resolve restrita/producao) e
// SEFIN_DRY_RUN=1 (forca mock).
//
// Spec: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
// ============================================================================

import {
    consumirDFe,
    consultarNfsePorChave,
    consultarEventos,
    getSefinMode,
} from './sefin-client.js';

// ─── MockProvider ─────────────────────────────────────────────────────────
class MockProvider {
    async buscarTomadas({ empresaId, cnpj, ultimoNSU }) {
        const seq = Math.max(ultimoNSU + 1, 1);
        const chave1 = `35${String(seq).padStart(8, '0')}MOCK${cnpj}3550308${String(seq).padStart(10, '0')}`.slice(0, 50).padEnd(50, '0');
        const chave2 = `35${String(seq + 1).padStart(8, '0')}MOCK${cnpj}3550308${String(seq + 1).padStart(10, '0')}`.slice(0, 50).padEnd(50, '0');

        return {
            status: 200,
            ultimoNSURecebido: seq + 1,
            maxNSU: seq + 1,
            documentos: [
                {
                    nsu: seq,
                    chaveAcesso: chave1,
                    dataEmissao: new Date().toISOString(),
                    prestador: { cnpj: '11222333000181', nome: 'PRESTADOR MOCK LTDA', im: '12345' },
                    tomador: { cnpj, nome: 'TOMADOR CAPTURADO' },
                    servico: {
                        codigoNbs: '1.0501.10.00',
                        descricao: 'Serviço mock de consultoria',
                        valor: 1500.00,
                        aliquotaIss: 5,
                        issValor: 75.00,
                        issRetido: 0,
                        municipioPrestacao: '3550308',
                    },
                    retencoes: { irrf: 22.50, csll: 15.00, pis: 9.75, cofins: 45.00, inss: 0 },
                    xmlContent: `<NFSe-mock>${chave1}</NFSe-mock>`,
                },
                {
                    nsu: seq + 1,
                    chaveAcesso: chave2,
                    dataEmissao: new Date().toISOString(),
                    prestador: { cnpj: '22333444000172', nome: 'OUTRO PRESTADOR MOCK ME', im: '67890' },
                    tomador: { cnpj, nome: 'TOMADOR CAPTURADO' },
                    servico: {
                        codigoNbs: '1.0701.10.00',
                        descricao: 'Locação de equipamentos',
                        valor: 800.00,
                        aliquotaIss: 3,
                        issValor: 24.00,
                        issRetido: 0,
                        municipioPrestacao: '3550308',
                    },
                    retencoes: { irrf: 0, csll: 0, pis: 0, cofins: 0, inss: 0 },
                    xmlContent: `<NFSe-mock>${chave2}</NFSe-mock>`,
                },
            ],
        };
    }

    async consultarPorChave({ empresaId, chave }) {
        return { status: 200, chave, mock: true };
    }

    async consultarEventos({ empresaId, chave }) {
        return { status: 200, chave, eventos: [], mock: true };
    }
}

// ─── SefinProvider (restrita/producao) ────────────────────────────────────
class SefinProvider {
    async buscarTomadas({ empresaId, cnpj, ultimoNSU }) {
        const res = await consumirDFe(empresaId, ultimoNSU);

        if (res.status !== 200) {
            return {
                status: res.status,
                erro: res.body?.message || res.body?.erro || 'Erro Sefin',
                bodyRaw: res.body,
                documentos: [],
            };
        }

        // Parsing da resposta DFe — o ADN retorna lista de DPS+eventos.
        // Estrutura tipica (ver spec gov.br/nfse):
        //   { ultimoNSU, maxNSU, documentos: [ { nsu, chave, xmlBase64Gzip, ... } ] }
        const body = res.body || {};
        const documentos = (body.LoteDFe || body.documentos || []).map(d => ({
            nsu: d.nsu || d.NSU,
            chaveAcesso: d.chaveAcesso || d.chNFSe,
            dataEmissao: d.dataEmissao || d.dhEmi,
            // XML vem em GZip+Base64 — decode acontece no orchestrator
            xmlGzipBase64: d.xmlGZipB64 || d.arquivo,
            tipoDocumento: d.tipoDocumento || 'NFSe',  // pode ser 'NFSe', 'Evento'
        }));

        return {
            status: 200,
            ultimoNSURecebido: body.ultimoNSU || body.ultimoNSURecebido,
            maxNSU: body.maxNSU,
            documentos,
            rawResponse: body,
        };
    }

    async consultarPorChave({ empresaId, chave }) {
        return await consultarNfsePorChave(empresaId, chave);
    }

    async consultarEventos({ empresaId, chave }) {
        return await consultarEventos(empresaId, chave);
    }
}

// ─── Singletons ───────────────────────────────────────────────────────────
let _provider = null;

export function getNfseTomadaProvider() {
    if (_provider) return _provider;
    const mode = getNfseTomadaMode();
    _provider = (mode === 'mock' || mode === 'dry-run')
        ? new MockProvider()
        : new SefinProvider();
    return _provider;
}

export function getNfseTomadaMode() {
    const sefinMode = getSefinMode();
    if (sefinMode === 'dry-run') return 'mock';
    return sefinMode; // 'restrita' | 'producao'
}

export function resetNfseTomadaProvider() {
    _provider = null;
}
