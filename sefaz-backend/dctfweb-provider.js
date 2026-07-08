// ============================================================================
// sefaz-backend/dctfweb-provider.js
// Provider DCTFWeb — mock + SERPRO Integra Contador (idSistema=DCTFWEB).
//
// idServicos (catálogo OFICIAL — confirmado 07/07/2026 após ICGERENCIADOR-052
// na transmissão: os antigos TRANSDECLARACAO11/GERARDOCUMENTOARRECADACAO12/
// GERARDARFANDAMENTO eram nomes copiados do PGDASD ou chutados e NÃO existem
// no catálogo do sistema DCTFWEB):
//   TRANSDECLARACAO310          (/Declarar)  transmite declaracao em andamento
//   GERARGUIA31                 (/Emitir)    gera DARF da declaracao ATIVA
//   GERARGUIAANDAMENTO313       (/Emitir)    DARF p/ declaracao em andamento
//   CONSRECIBO32                (/Consultar) recibo de transmissao (PDF)
//   CONSDECCOMPLETA33           (/Consultar) declaracao ATIVA (PDF)
//   CONSXMLDECLARACAO38         (/Consultar) XML
//   MIT / ENCAPURACAO314        (/Declarar)  encerra MIT
//   MIT / SITUACAOENC315        (/Consultar) status encerramento MIT
//   MIT / CONSAPURACAO316       (/Consultar) detalhes por idApuracao
//   MIT / LISTAAPURACOES317     (/Consultar) historico anual/mensal MIT
//
// Custo SERPRO: ~R$ 0,75 por TRANSDEC/GERARDARF; demais ~R$ 0,06-0,40.
// Troca via env DCTFWEB_MODE — sem rebuild.
// ============================================================================

import { invokeIntegraContador } from './serpro-client.js';
import { loadCertificate } from './secret-loader.js';
import { assinarXmlDctfwebBase64 } from './dctfweb-xml-signer.js';

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

export const MIT_SERVICOS = {
    ENCERRAR_APURACAO: 'ENCAPURACAO314',
    SITUACAO_ENCERRAMENTO: 'SITUACAOENC315',
    CONSULTAR_APURACAO: 'CONSAPURACAO316',
    LISTAR_APURACOES: 'LISTAAPURACOES317',
};

function safeJsonParse(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return s; }
}

// Alguns serviços do Integra Contador devolvem `dados` como LISTA com um
// único objeto — normaliza pro objeto.
function primeiroObjeto(d) {
    if (Array.isArray(d)) return (d[0] && typeof d[0] === 'object') ? d[0] : {};
    return (d && typeof d === 'object') ? d : {};
}

function pickPdfBase64(d) {
    return d?.PDFByteArrayBase64 || d?.pdfBase64 || '';
}

// O catálogo do Integra Contador aceita a categoria pelo NOME (GERAL_MENSAL
// etc). Os códigos internos do app (DCTFWEB_CATEGORIAS, manual RFB) NÃO são
// os códigos do catálogo SERPRO (lá GERAL_MENSAL=40) — nunca enviar número
// do app pro SERPRO (caso real 08/07/2026: CONSRECIBO32 com categoria 13
// voltava 200 sem PDF).
function nomeCategoria(categoria) {
    if (typeof categoria === 'string' && categoria && !/^\d+$/.test(categoria)) return categoria;
    const codigo = Number(categoria);
    const nome = Object.keys(DCTFWEB_CATEGORIAS).find((k) => DCTFWEB_CATEGORIAS[k] === codigo);
    return nome || 'GERAL_MENSAL';
}

// _raw sem o PDF gigante (o base64 já vai em pdfBase64 — duplicar dobra o
// payload da resposta).
function rawSemPdf(d) {
    if (!d || typeof d !== 'object') return d;
    const { PDFByteArrayBase64, pdfBase64, ...resto } = d;
    return resto;
}

function hashCnpj(cnpj) {
    let h = 0;
    for (const c of String(cnpj || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
}

function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function pickApuracoes(dados) {
    return asArray(
        dados?.Apuracoes
        || dados?.apuracoes
        || dados?.ListaApuracoes
        || dados?.listaApuracoes
        || dados?.apApuracoes
    );
}

function sameMitPeriod(item, anoPA, mesPA) {
    const periodoObj = (item?.PeriodoApuracao && typeof item.PeriodoApuracao === 'object')
        ? item.PeriodoApuracao
        : ((item?.periodoApuracao && typeof item.periodoApuracao === 'object') ? item.periodoApuracao : null);
    if (periodoObj) {
        const ano = Number(periodoObj.AnoApuracao ?? periodoObj.anoApuracao ?? periodoObj.anoPA ?? periodoObj.ano);
        const mes = Number(periodoObj.MesApuracao ?? periodoObj.mesApuracao ?? periodoObj.mesPA ?? periodoObj.mes);
        return ano === Number(anoPA) && mes === Number(mesPA);
    }

    const periodo = String(item?.periodoApuracao || item?.PeriodoApuracao || item?.periodo || '').replace(/\D/g, '');
    if (periodo.length === 6) {
        return periodo === `${anoPA}${String(mesPA).padStart(2, '0')}`;
    }
    const ano = Number(item?.anoApuracao ?? item?.AnoApuracao ?? item?.anoPA ?? item?.ano);
    const mes = Number(item?.mesApuracao ?? item?.MesApuracao ?? item?.mesPA ?? item?.mes);
    return ano === Number(anoPA) && mes === Number(mesPA);
}

export function pickIdApuracao(item) {
    return item?.idApuracao ?? item?.IdApuracao ?? item?.identEFD ?? item?.id;
}

// Extrai o período (YYYYMM) de um item do histórico MIT — mesmos shapes que
// sameMitPeriod entende. Usado pra mensagem diagnóstica ("períodos existentes")
// quando a competência pedida não aparece.
export function mitPeriodoLabel(item) {
    const periodoObj = (item?.PeriodoApuracao && typeof item.PeriodoApuracao === 'object')
        ? item.PeriodoApuracao
        : ((item?.periodoApuracao && typeof item.periodoApuracao === 'object') ? item.periodoApuracao : null);
    if (periodoObj) {
        const ano = Number(periodoObj.AnoApuracao ?? periodoObj.anoApuracao ?? periodoObj.anoPA ?? periodoObj.ano);
        const mes = Number(periodoObj.MesApuracao ?? periodoObj.mesApuracao ?? periodoObj.mesPA ?? periodoObj.mes);
        if (Number.isFinite(ano) && Number.isFinite(mes)) return `${ano}${String(mes).padStart(2, '0')}`;
        return null;
    }
    const periodo = String(item?.periodoApuracao || item?.PeriodoApuracao || item?.periodo || '').replace(/\D/g, '');
    if (periodo.length === 6) return periodo;
    const ano = Number(item?.anoApuracao ?? item?.AnoApuracao ?? item?.anoPA ?? item?.ano);
    const mes = Number(item?.mesApuracao ?? item?.MesApuracao ?? item?.mesPA ?? item?.mes);
    if (Number.isFinite(ano) && Number.isFinite(mes)) return `${ano}${String(mes).padStart(2, '0')}`;
    return null;
}

export function pickDadosApuracaoMit(input) {
    if (!input || typeof input !== 'object') return null;
    if (Array.isArray(input)) return pickDadosApuracaoMit(input[0]);
    if (input.PeriodoApuracao) return input;

    const direct = input.dadosApuracaoMit ?? input.dadosApuracaoMIT ?? input.DadosApuracaoMit ?? input.DadosApuracaoMIT;
    if (Array.isArray(direct)) return direct[0] || null;
    if (direct && typeof direct === 'object') return direct;

    const nested = input.apuracaoMit ?? input.apuracao ?? input.dados;
    if (nested && nested !== input) return pickDadosApuracaoMit(nested);
    return null;
}

// Conta débitos REAIS no bloco Debitos do MIT. O shape oficial é
// { Irpj: { ListaDebitos: [...] }, Csll: {...}, ... } — mas uma apuração
// criada no e-CAC e ainda em edição volta com Debitos presente porém VAZIO
// ({} ou grupos com ListaDebitos: []). Checar só a existência da chave
// deixava o encerramento passar e o SERPRO devolvia 400
// [EntradaIncorreta-MIT-MSG_0003] "Debitos: deve ser informado ao menos um
// débito" (caso real 55070577000161 · 06/2026, 07/07/2026).
export function contarDebitosMit(debitos) {
    if (!debitos) return 0;
    if (Array.isArray(debitos)) return debitos.filter((d) => d && typeof d === 'object').length;
    if (typeof debitos !== 'object') return 0;
    let total = 0;
    for (const valor of Object.values(debitos)) {
        if (Array.isArray(valor)) total += valor.filter((d) => d && typeof d === 'object').length;
        else if (valor && typeof valor === 'object') total += contarDebitosMit(valor);
    }
    return total;
}

// Extrai da mensagem de erro do SERPRO os caminhos de campo recusados com
// "campo não deve ser informado" (ex.: "DadosIniciais.RegimePisCofins").
export function extrairCamposNaoInformaveis(mensagem) {
    const out = [];
    for (const m of String(mensagem || '').matchAll(/([A-Za-z][\w.]*)\s*:\s*campo n[ãa]o deve ser informado/gi)) {
        out.push(m[1]);
    }
    return [...new Set(out)];
}

// Extrai o XML da resposta do CONSXMLDECLARACAO38. O Integra Contador devolve
// o XML em dados.XMLStringBase64 (base64) — o código antigo só olhava
// XMLByteArrayBase64/xmlBase64 (nomes do PDF/chutados) e a transmissão falhava
// com "CONSXMLDECLARACAO38 vazio" mesmo com a resposta 200 cheia (caso
// RADIO E TV 06/2026, 08/07/2026). Aceita também dados como string crua
// (XML direto ou base64 sem wrapper JSON) e, em último caso, varre qualquer
// campo string cujo conteúdo (cru ou decodificado) pareça XML.
export function extrairXmlDeclaracao(dados) {
    const comoXml = (valor) => {
        const s = String(valor ?? '').trim();
        if (!s) return '';
        if (s.startsWith('<')) return s;
        try {
            const texto = Buffer.from(s, 'base64').toString('utf8');
            return texto.trimStart().startsWith('<') ? texto : '';
        } catch { return ''; }
    };
    if (typeof dados === 'string') return comoXml(dados);
    if (!dados || typeof dados !== 'object') return '';
    const candidatos = [
        dados.XMLStringBase64, dados.xmlStringBase64,
        dados.XMLByteArrayBase64, dados.xmlBase64,
        dados.xml, dados.XMLDeclaracao, dados.declaracaoXml,
    ];
    for (const c of candidatos) {
        const xml = comoXml(c);
        if (xml) return xml;
    }
    for (const v of Object.values(dados)) {
        if (typeof v !== 'string') continue;
        const xml = comoXml(v);
        if (xml) return xml;
    }
    return '';
}

// Remove um campo aninhado por caminho pontuado ("DadosIniciais.RegimePisCofins").
// Retorna true se o campo existia e foi removido.
export function removerCampoPorCaminho(obj, caminho) {
    const partes = String(caminho || '').split('.').filter(Boolean);
    if (partes.length === 0) return false;
    let alvo = obj;
    for (let i = 0; i < partes.length - 1; i++) {
        alvo = alvo?.[partes[i]];
        if (!alvo || typeof alvo !== 'object') return false;
    }
    const ultima = partes[partes.length - 1];
    if (alvo && typeof alvo === 'object' && Object.prototype.hasOwnProperty.call(alvo, ultima)) {
        delete alvo[ultima];
        return true;
    }
    return false;
}

function ensureMitEncerramentoPayload({ dadosApuracaoMit, anoPA, mesPA }) {
    const payload = pickDadosApuracaoMit(dadosApuracaoMit);
    if (!payload) {
        throw new Error(
            'Encerramento MIT requer a apuracao completa (PeriodoApuracao, DadosIniciais e, quando houver movimento, Debitos). ' +
            'A integracao nao pode transmitir MIT apenas com ano/mes.'
        );
    }
    const dados = {
        ...payload,
        PeriodoApuracao: payload.PeriodoApuracao || {
            MesApuracao: Number(mesPA),
            AnoApuracao: Number(anoPA),
        },
    };
    const dadosIniciais = dados.DadosIniciais || dados.dadosIniciais;
    if (!dadosIniciais) {
        throw new Error('Encerramento MIT requer DadosIniciais no payload oficial da apuracao.');
    }
    const semMovimento = dadosIniciais.SemMovimento ?? dadosIniciais.semMovimento;
    const temDebitos = contarDebitosMit(dados.Debitos || dados.debitos) > 0;
    if (semMovimento !== true && semMovimento !== 'true' && !temDebitos) {
        throw new Error(
            'A apuracao MIT esta com movimento mas sem nenhum debito lancado. '
            + 'Lance os debitos (IRPJ/CSLL/PIS/COFINS) no MIT do e-CAC — ou marque Sem Movimento — '
            + 'e clique em "Atualizar MIT" antes de encerrar.'
        );
    }
    return dados;
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
        const cnpj = String(empresaCnpj || '').replace(/\D/g, '');
        const seed = hashCnpj(empresaCnpj);
        const inss = (500 + (seed % 2000)).toFixed(2); // ponto decimal (igual real)
        // XML no shape REAL do CONSXMLDECLARACAO (ProcDctf > CreditoTributarioApurado).
        // Inclui 1 retencao Reinf (INSS 1162) + 1 debito proprio (patronal 1138,
        // que o normalizador deve IGNORAR) — exercita o filtro por codReceita.
        const xml = `<?xml version="1.0" encoding="utf-8"?>`
            + `<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1"><ConteudoDeclaracao>`
            + `<DctfXml versao="3.0"><A000-DadosIdentificadoresContribuinte>`
            + `<inscContrib>${cnpj}</inscContrib><perApuracao>${String(mesPA).padStart(2,'0')}${anoPA}</perApuracao>`
            + `<categoriaDCTF>40</categoriaDCTF><A050-CreditosTributariosApurados>`
            + `<CreditoTributarioApurado><codReceita>113801</codReceita>`
            + `<ctDescricaoTributo>CP PATRONAL - EMPREGADOS/AVULSOS</ctDescricaoTributo>`
            + `<ctValor>1000.00</ctValor><saldoaPagar>1000.00</saldoaPagar></CreditoTributarioApurado>`
            + `<CreditoTributarioApurado><codReceita>116201</codReceita>`
            + `<ctDescricaoTributo>CP PATRONAL - RETENCAO LEI 9.711/98</ctDescricaoTributo>`
            + `<ctValor>${inss}</ctValor><ctCnpj>03222111000130</ctCnpj>`
            + `<saldoaPagar>${inss}</saldoaPagar></CreditoTributarioApurado>`
            + `</A050-CreditosTributariosApurados></A000-DadosIdentificadoresContribuinte>`
            + `</DctfXml></ConteudoDeclaracao></ProcDctf>`;
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
            const msg = String(err?.message || '');
            // DCTFWEB-MG10: "declaração mais recente em Andamento, incompatível
            // com a funcionalidade — informe numeroReciboEntrega". NÃO é erro:
            // é o estado normal de uma declaração gerada (ex.: pelo encerramento
            // do MIT) e ainda não transmitida — recibo/PDF só existem depois da
            // transmissão. Mostrar o texto cru do SERPRO como ⚠ assustava o
            // colaborador (caso RADIO E TV 06/2026, 07/07/2026).
            const aguardandoTransmissao = /DCTFWEB-MG10/i.test(msg)
                || /Em Andamento.{0,40}incompat/i.test(msg);
            return [{
                id: `${cnpj}_${ano}${String(mes).padStart(2,'0')}_${cat}`,
                empresaCnpj: cnpj,
                categoria: cat,
                categoriaCodigo: DCTFWEB_CATEGORIAS[cat] || 0,
                anoPA: ano,
                mesPA: mes,
                situacao: 'EM_ANDAMENTO',
                _erro: aguardandoTransmissao ? null : msg,
                _info: aguardandoTransmissao
                    ? 'Declaração gerada (ex.: pelo encerramento do MIT) e aguardando transmissão. '
                      + 'Clique em "Transmitir" — recibo, PDF e DARF ficam disponíveis depois.'
                    : null,
                fonte: 'serpro',
            }];
        }
    }

    async transmitirDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');

        // O TRANSDECLARACAO310 exige o XML da declaração ASSINADO digitalmente
        // em base64 (erro DCTFWEB-MG07 / TRANS21_Xml_Assinado_Base64_Ausente
        // sem ele — caso real 07/07/2026). Fluxo oficial:
        //   1. CONSXMLDECLARACAO38 → XML da declaração em andamento
        //   2. assinatura XMLDSig (e-CNPJ do escritório, procuração e-CAC)
        //   3. TRANSDECLARACAO310 com dados.xmlAssinadoBase64
        const consulta = await this.consultarXmlDeclaracao({ empresaCnpj: cnpj, anoPA, mesPA, categoria });
        const xmlDeclaracao = String(consulta?.xml || '').trim();
        if (!xmlDeclaracao) {
            // Inclui o que o SERPRO devolveu de fato — sem isso o erro é
            // indiagnosticável ("vazio" podia ser campo com outro nome,
            // mensagem de negócio no corpo 200, etc).
            const raw = consulta?._raw;
            const chaves = (raw && typeof raw === 'object') ? Object.keys(raw).join(', ')
                : (typeof raw === 'string' ? `string(${raw.slice(0, 120)})` : '');
            const msgs = (consulta?.mensagens || [])
                .map((m) => (m?.codigo ? `${m.codigo} - ${m.texto || ''}` : (m?.texto || '')))
                .filter(Boolean)
                .join('; ');
            throw new Error(
                `Transmissão DCTFWeb: o SERPRO não retornou o XML da declaração ${anoPA}-${String(mesPA).padStart(2, '0')} `
                + '(CONSXMLDECLARACAO38 vazio). Confirme que a declaração está "Em andamento" e sincronize antes de transmitir.'
                + (msgs ? ` Mensagens SERPRO: ${msgs}.` : '')
                + (chaves ? ` Campos retornados: ${chaves}.` : '')
            );
        }

        const cert = await loadCertificate();
        if (!cert?.pemKey || !cert?.pemCert) {
            throw new Error('Transmissão DCTFWeb: certificado A1 do escritório indisponível para assinar o XML da declaração.');
        }
        const xmlAssinadoBase64 = assinarXmlDctfwebBase64({
            xml: xmlDeclaracao,
            privateKeyPem: cert.pemKey,
            certificatePem: cert.pemCert,
        });

        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'TRANSDECLARACAO310',
            contribuinteCnpj: cnpj,
            acao: 'Declarar',
            dados: {
                categoria,
                anoPA: String(anoPA),
                mesPA: String(mesPA).padStart(2, '0'),
                xmlAssinadoBase64,
            },
        });
        const d = primeiroObjeto(safeJsonParse(r.dados));
        // Shape oficial do TRANSDECLARACAO310: numeroRecibo, dataTransmissao,
        // horaTransmissao, situacao (caso real 08/07/2026: recibo ficava
        // "Não informado" — só se buscava numeroRecibo/recibo).
        const numeroRecibo = String(
            d.numeroRecibo ?? d.recibo ?? d.numRecibo ?? d.numeroReciboEntrega ?? ''
        );
        const transmitidoEm = d.dataHoraTransmissao
            || (d.dataTransmissao ? `${d.dataTransmissao}${d.horaTransmissao ? ` ${d.horaTransmissao}` : ''}` : '')
            || new Date().toISOString();
        return {
            _raw: d,
            mensagens: r.mensagens || [],
            categoria,
            numeroRecibo,
            transmitidoEm,
            situacao: 'ATIVA',
            fonte: 'serpro',
        };
    }

    async gerarDarf({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL', emAndamento = false }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const idServico = emAndamento ? 'GERARGUIAANDAMENTO313' : 'GERARGUIA31';
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico,
            contribuinteCnpj: cnpj,
            acao: 'Emitir',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = primeiroObjeto(safeJsonParse(r.dados));
        // O GERARGUIA31/GERARGUIAANDAMENTO313 retorna APENAS o PDF do DARF
        // (PDFByteArrayBase64) — valor/vencimento/código de barras estão só
        // dentro do PDF. valor=null (não 0 fake) quando o SERPRO não manda.
        const valorNum = parseFloat(d.valor || d.valorTotal || '');
        return {
            _raw: rawSemPdf(d),
            mensagens: r.mensagens || [],
            valor: Number.isFinite(valorNum) ? valorNum : null,
            numeroDocumento: d.numeroDocumento || d.numeroDarf || '',
            codigoBarras: d.codigoBarras || d.linhaDigitavel || '',
            vencimento: d.dataVencimento || d.vencimento || '',
            pdfBase64: pickPdfBase64(d),
            fonte: 'serpro',
        };
    }

    async consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const cat = nomeCategoria(categoria);
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSDECCOMPLETA33',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria: cat, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = primeiroObjeto(safeJsonParse(r.dados));
        const pdfBase64 = pickPdfBase64(d);
        return {
            pdfBase64,
            mensagens: r.mensagens || [],
            // Sem PDF: expõe o que o SERPRO devolveu (senão o "vazio" é indiagnosticável)
            _camposRetornados: pdfBase64 ? undefined : Object.keys(d),
            categoria: cat, anoPA, mesPA, fonte: 'serpro',
        };
    }

    async consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        // Categoria pelo NOME — o código numérico do app (GERAL_MENSAL=13) não
        // é o do catálogo SERPRO (40); enviar 13 devolvia 200 sem PDF
        // (caso real 08/07/2026, primeiro recibo após transmissão).
        const cat = nomeCategoria(categoria);
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSRECIBO32',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria: cat, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2,'0') },
        });
        const d = primeiroObjeto(safeJsonParse(r.dados));
        const pdfBase64 = pickPdfBase64(d);
        return {
            pdfBase64,
            mensagens: r.mensagens || [],
            _camposRetornados: pdfBase64 ? undefined : Object.keys(d),
            categoria: cat, anoPA, mesPA, fonte: 'serpro',
        };
    }

    async encerrarApuracaoMit({ empresaCnpj, anoPA, mesPA, dadosApuracaoMit }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        // Deep-copy: o loop abaixo pode REMOVER campos do payload e não deve
        // mutar o objeto do chamador.
        const dados = JSON.parse(JSON.stringify(
            ensureMitEncerramentoPayload({ dadosApuracaoMit, anoPA, mesPA })
        ));

        // O CONSAPURACAO316 devolve campos que o ENCAPURACAO314 REJEITA
        // conforme o regime — caso real 55070577000161 · 06/2026: apuração
        // Lucro Presumido (TributacaoLucro=3) volta com
        // DadosIniciais.RegimePisCofins, e o encerramento responde 400
        // [EntradaIncorreta-MIT-MSG_0003] "campo não deve ser informado"
        // (o regime PIS/COFINS só é informável no Lucro Real). Em vez de
        // codificar o schema condicional do SERPRO (e errar), removemos
        // exatamente o(s) campo(s) que ele apontar e retransmitimos —
        // no máximo 4 rodadas pra nunca virar loop.
        const camposRemovidos = [];
        let r = null;
        for (let tentativa = 0; tentativa < 4; tentativa++) {
            try {
                r = await invokeIntegraContador({
                    idSistema: 'MIT',
                    idServico: MIT_SERVICOS.ENCERRAR_APURACAO,
                    contribuinteCnpj: cnpj,
                    acao: 'Declarar',
                    dados,
                });
                break;
            } catch (e) {
                const campos = extrairCamposNaoInformaveis(e?.message);
                if (campos.length === 0) throw e;
                let removeuAlgum = false;
                for (const caminho of campos) {
                    if (removerCampoPorCaminho(dados, caminho)) {
                        camposRemovidos.push(caminho);
                        removeuAlgum = true;
                    }
                }
                if (!removeuAlgum) throw e; // campo apontado não existe no payload — não insistir
                console.warn(`[encerrarApuracaoMit] SERPRO recusou campo(s) ${campos.join(', ')} — removido(s), retransmitindo (tentativa ${tentativa + 2})`);
            }
        }
        if (!r) {
            throw new Error(
                `Encerramento MIT abortado: SERPRO seguiu recusando o payload mesmo após remover ${camposRemovidos.join(', ')}.`
            );
        }

        const d = safeJsonParse(r.dados) || {};
        return {
            _raw: d,
            idApuracao: d.idApuracao ?? d.IdApuracao ?? null,
            statusEncerramento: d.statusEncerramento || d.status || 'PROCESSANDO',
            protocolo: d.protocoloEncerramento || d.protocolo || '',
            camposRemovidos: camposRemovidos.length > 0 ? camposRemovidos : undefined,
            fonte: 'serpro',
        };
    }

    async consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        if (!protocolo) {
            throw new Error('Consultar situação do encerramento MIT requer protocoloEncerramento.');
        }
        const r = await invokeIntegraContador({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.SITUACAO_ENCERRAMENTO,
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { protocoloEncerramento: protocolo },
        });
        const d = safeJsonParse(r.dados) || {};
        return {
            _raw: d,
            idApuracao: d.idApuracao ?? d.IdApuracao ?? null,
            situacaoApuracao: d.situacaoApuracao ?? d.SituacaoApuracao ?? null,
            statusEncerramento: d.textoSituacao || d.statusEncerramento || d.status || 'DESCONHECIDO',
            protocolo,
            avisosDctf: d.avisosDctf || d.avisosDCTF || [],
            fonte: 'serpro',
        };
    }

    async consultarApuracaoMit({ empresaCnpj, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const historico = await this.consultarApuracoesAno({ empresaCnpj: cnpj, anoPA });
        const apuracoes = historico.apuracoes || [];
        let apuracaoRef = apuracoes.find((x) => sameMitPeriod(x, anoPA, mesPA));

        // Fallback dirigido ao MÊS. O catálogo SERPRO documenta LISTAAPURACOES317
        // "por ano OU mês" — a consulta anual pode não trazer a competência
        // pedida (ex.: apuração recém-criada/em edição). Caso real 07/07/2026:
        // histórico 2026 voltou 7 apurações sem a 202606, e o painel travava o
        // encerramento com "nenhuma apuração encontrada" sem tentar o mês.
        let consultaMensalFalhou = null;
        if (!apuracaoRef) {
            try {
                const doMes = await this.consultarApuracoesAno({ empresaCnpj: cnpj, anoPA, mesPA });
                const apuracoesMes = doMes.apuracoes || [];
                apuracaoRef = apuracoesMes.find((x) => sameMitPeriod(x, anoPA, mesPA));
                // Agrega ao histórico devolvido (sem duplicar por idApuracao)
                const idsConhecidos = new Set(apuracoes.map((x) => String(pickIdApuracao(x) ?? '')));
                for (const item of apuracoesMes) {
                    const id = String(pickIdApuracao(item) ?? '');
                    if (!id || !idsConhecidos.has(id)) apuracoes.push(item);
                }
            } catch (e) {
                consultaMensalFalhou = e?.message || String(e);
                console.warn(`[dctfweb-provider] LISTAAPURACOES317 por mês falhou (${anoPA}-${mesPA}):`, consultaMensalFalhou);
            }
        }

        const idApuracao = pickIdApuracao(apuracaoRef);
        if (idApuracao == null || idApuracao === '') {
            const pa = `${anoPA}${String(mesPA).padStart(2, '0')}`;
            const periodos = [...new Set(apuracoes.map(mitPeriodoLabel).filter(Boolean))].sort();
            const partes = [
                consultaMensalFalhou
                    ? `Nenhuma apuração MIT encontrada para ${pa} no histórico anual (consulta por mês falhou: ${consultaMensalFalhou}).`
                    : `Nenhuma apuração MIT encontrada para ${pa} (consultado por ano e por mês no SERPRO).`,
            ];
            if (periodos.length > 0) {
                partes.push(`Períodos existentes no MIT: ${periodos.join(', ')}.`);
            }
            partes.push(
                'A apuração desta competência ainda não foi criada no MIT. Use o preenchimento automático '
                + '(Lucro Presumido → empresa → Conferir DCTFWeb → "Preencher MIT com os valores do app"), '
                + 'que cria e encerra a apuração com os dados do mês anterior — ou crie-a manualmente no e-CAC '
                + '(DCTFWeb → Módulo de Inclusão de Tributos) e clique em "Atualizar MIT".'
            );
            return {
                apuracaoMit: null,
                apuracoes,
                motivo: partes.join(' '),
                fonte: 'serpro',
            };
        }
        const detalhe = await this.consultarApuracaoMitPorId({ empresaCnpj: cnpj, idApuracao });
        return {
            ...detalhe,
            apuracaoResumo: apuracaoRef,
        };
    }

    // Detalhe de UMA apuração MIT pelo idApuracao (CONSAPURACAO316). Usado
    // pelo fluxo normal (acima) e pelo preenchimento automático de débitos,
    // que precisa do detalhe do mês-modelo para copiar os códigos de débito.
    async consultarApuracaoMitPorId({ empresaCnpj, idApuracao }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.CONSULTAR_APURACAO,
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { idApuracao: Number(idApuracao) },
        });
        const d = safeJsonParse(r.dados) || {};
        return {
            apuracaoMit: d.apuracao || d.dadosApuracaoMit || d.dadosApuracaoMIT || d,
            idApuracao: Number(idApuracao),
            fonte: 'serpro',
        };
    }

    async consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'DCTFWEB',
            idServico: 'CONSXMLDECLARACAO38',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { categoria, anoPA: String(anoPA), mesPA: String(mesPA).padStart(2, '0') },
        });
        const d = safeJsonParse(r.dados) || {};
        // Shape oficial: dados.XMLStringBase64 (base64). extrairXmlDeclaracao
        // cobre também os legados/variantes e dados vindo como string crua.
        const xml = extrairXmlDeclaracao(d);
        return { xml, _raw: d, mensagens: r.mensagens || [], categoria, anoPA, mesPA, fonte: 'serpro' };
    }

    async consultarApuracoesAno({ empresaCnpj, anoPA, mesPA }) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const dados = { anoApuracao: Number(anoPA) };
        if (mesPA) dados.mesApuracao = Number(mesPA);
        const r = await invokeIntegraContador({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.LISTAR_APURACOES,
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados,
        });
        const d = safeJsonParse(r.dados) || {};
        return { ano: anoPA, mes: mesPA || null, apuracoes: pickApuracoes(d), _raw: d, fonte: 'serpro' };
    }
}


let providerInstance = null;
export function getDctfwebProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = (MODE === 'serpro') ? new SerproProvider() : new MockProvider();
    return providerInstance;
}

export function getDctfwebMode() { return MODE; }
