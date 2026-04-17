import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import * as XLSX from 'xlsx';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use('/api/', rateLimit({ windowMs: 60000, max: 120, message: { error: 'Aguarde.' } }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let ai = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log('Gemini API configurada');
} else {
    console.warn('GEMINI_API_KEY nao configurada');
}

const requireAI = (req, res, next) => {
    if (!ai) return res.status(503).json({ error: 'IA indisponivel' });
    next();
};

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ai: !!ai, timestamp: new Date().toISOString() });
});

app.post('/api/fiscal/query', requireAI, async (req, res) => {
    const { prompt, model, temperature, googleSearch } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt obrigatorio' });
    try {
        const requestBody = { model: model || 'gemini-2.0-flash', contents: prompt };
        if (temperature !== undefined) requestBody.config = { temperature };
        if (googleSearch) {
            requestBody.config = requestBody.config || {};
            requestBody.config.tools = [{ googleSearch: {} }];
        }
        const response = await ai.models.generateContent(requestBody);
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        console.error('Erro Gemini:', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro IA' });
    }
});

app.post('/api/fiscal/multimodal', requireAI, async (req, res) => {
    const { prompt, base64Data, mimeType, model } = req.body;
    if (!prompt || !base64Data || !mimeType) return res.status(400).json({ error: 'campos obrigatorios' });
    try {
        const response = await ai.models.generateContent({
            model: model || 'gemini-2.0-flash',
            contents: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }],
        });
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        return res.status(500).json({ error: err?.message || 'Erro' });
    }
});


// ─── Análise de Créditos Fiscais ────────────────────────────────────────────
function xmlTag(xml, tag) {
    const m = xml.match(new RegExp('<' + tag + '[^>]*>([^<]*)<\/' + tag + '>'));
    return m ? m[1].trim() : '';
}
function analisarPisCofins(nota, regime) {
    if (regime === 'SIMPLES') return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'Simples Nacional não gera créditos de PIS/COFINS.', fundamentoLegal:'Lei 123/2006, art. 23', avisos:[] };
    if (regime === 'LUCRO_PRESUMIDO') return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'Lucro Presumido sujeito ao regime cumulativo — sem crédito.', fundamentoLegal:'Lei 9.718/1998', avisos:[] };
    const cfop = String(nota.cfop||'');
    const cst  = String(nota.cst||'');
    const base = parseFloat(nota.valorTotal||nota.vProd||0);
    if (!cfop.startsWith('1') && !cfop.startsWith('2'))
        return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'CFOP de saída não gera crédito de PIS/COFINS.', fundamentoLegal:'Lei 10.637/2002, art. 3º', avisos:[] };
    const cstOk  = ['01','02','50','51','55','99','1','2'];
    const cstNeg = ['04','06','07','08','09','4','6','7','8','9'];
    if (cstOk.includes(cst))
        return { tipo:'APROVADO', creditoPIS:+(base*0.0165).toFixed(2), creditoCOFINS:+(base*0.076).toFixed(2), observacao:'Crédito integral — CST permite aproveitamento pleno.', fundamentoLegal:'Lei 10.637/2002 e 10.833/2003, art. 3º', avisos:[] };
    if (cstNeg.includes(cst))
        return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'CST indica isenção/não incidência — sem crédito.', fundamentoLegal:'IN RFB 2.121/2022', avisos:[] };
    return { tipo:'REVISAR', creditoPIS:0, creditoCOFINS:0, observacao:'CST/CFOP requer análise individualizada.', fundamentoLegal:'Lei 10.637/2002 e 10.833/2003', avisos:['Consulte o contador responsável'] };
}
function analisarIcms(nota) {
    const cfop  = String(nota.cfop||'');
    const cst   = String(nota.cst||'');
    const vICMS = parseFloat(nota.valorIcms||nota.vICMS||0);
    if (!cfop.startsWith('1') && !cfop.startsWith('2'))
        return { tipo:'NEGADO', creditoIcms:0, observacao:'CFOP de saída não gera crédito de ICMS.', fundamentoLegal:'RICMS', avisos:[] };
    if (['40','41','50'].includes(cst))
        return { tipo:'NEGADO', creditoIcms:0, observacao:'Operação isenta/não tributada — sem ICMS a creditar.', fundamentoLegal:'CF/88 art.155 §2º I; RICMS', avisos:[] };
    if (['00','20'].includes(cst))
        return { tipo:'APROVADO', creditoIcms:vICMS, observacao:'ICMS destacado aproveitável como crédito.', fundamentoLegal:'CF/88 art.155 §2º I; RICMS', avisos:[] };
    if (cst.startsWith('1') || cst.startsWith('7'))
        return { tipo:'PARCIAL', creditoIcms:+(vICMS*0.5).toFixed(2), observacao:'Substituição tributária — crédito parcial conforme RICMS.', fundamentoLegal:'Convênio ICMS', avisos:['Verificar DIFAL e antecipação ST'] };
    return { tipo:'REVISAR', creditoIcms:0, observacao:'CST requer análise específica pelo regulamento estadual.', fundamentoLegal:'RICMS', avisos:['Verifique o RICMS do estado emissor'] };
}

// --- Analise de relatorio de despesas (xlsx) --------------------------------
const KEYWORDS={LUCRO_REAL_SERVICOS:['energia','aluguel','telefon','internet','licen','software','ti','medic','psicol','nutri','consultor','qualidade','saude'],LUCRO_REAL_COMERCIO:['mercadoria','compra','energia','aluguel','frete','internet','licen','software'],LUCRO_REAL_INDUSTRIA:['materia','insumo','embalagem','energia','aluguel','frete','deprecia','licen','software','ti'],LUCRO_REAL:['energia','aluguel','telefon','internet','licen','software','ti','medic','psicol','nutri','consultor']};
function hasCredito(tipo,regime){const kws=KEYWORDS[regime]||KEYWORDS.LUCRO_REAL_SERVICOS;const t=tipo.toLowerCase();return kws.some(k=>t.includes(k));}
function parseBRL(v){const s=String(v||'').trim().replace(/[^0-9,.]/g,'');if(!s)return 0;if(s.includes(',')){return parseFloat(s.replace(/\./g,'').replace(',','.'))||0;}if((s.match(/\./g)||[]).length>1){return parseFloat(s.replace(/\.(?=.*\.)/g,''))||0;}return parseFloat(s)||0;}
function parseXlsxExpense(buf){try{const wb=XLSX.read(buf,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});let hr=-1,ti=-1,vi=-1,fi=-1,ni=-1;for(let i=0;i<Math.min(rows.length,10);i++){const r=rows[i].map(x=>String(x).toLowerCase().trim());if(r.some(x=>x.includes('tipo'))||r.some(x=>x.includes('despesa'))){hr=i;ti=r.findIndex(h=>h.includes('tipo'));vi=r.findIndex(h=>h.includes('valor'));fi=r.findIndex(h=>h.includes('fornec'));ni=r.findIndex(h=>h.includes('nota'));break;}}if(hr<0||ti<0||vi<0)return null;const g={};for(let i=hr+1;i<rows.length;i++){const row=rows[i];const tipo=String(row[ti]||'').trim();if(!tipo||/^[\d.,]/.test(tipo)||tipo.toLowerCase().includes('total')||tipo.toLowerCase().includes('custo'))continue;const val=parseBRL(row[vi]);if(!val)continue;const forn=fi>=0?String(row[fi]||'').trim():'';const nota=ni>=0?String(row[ni]||'').trim():'';if(!g[tipo])g[tipo]={tipo,valor:0,count:0,entradas:[]};g[tipo].valor=+(g[tipo].valor+val).toFixed(2);g[tipo].count++;g[tipo].entradas.push({nota,forn,valor:val});}return Object.keys(g).length?g:null;}catch(e){console.error('XLSX parse error:',e.message);return null;}}
function calcularCreditoExpense(grupos,regime){const P=0.0165,CF=0.076;const det=Object.values(grupos).map(g=>{const ok=hasCredito(g.tipo,regime);const cP=ok?+(g.valor*P).toFixed(2):0;const cC=ok?+(g.valor*CF).toFixed(2):0;return{nota:{numero:g.tipo,emitente:g.count+' nota(s)',entradas:g.entradas||[],cfop:'N/A',cst:'N/A',natureza:g.tipo,valorTotal:g.valor,baseCalculo:g.valor,valorIcms:0,aliquotaIcms:0,tipo:'SERVICO'},pisCofins:{tipo:ok?'APROVADO':'NEGADO',creditoPIS:cP,creditoCOFINS:cC,observacao:ok?g.tipo+': base R$ '+g.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})+' | PIS 1,65% + COFINS 7,6%':g.tipo+': sem credito neste regime.',fundamentoLegal:ok?'Lei 10.637/2002 e 10.833/2003, art. 3':'IN RFB 2.121/2022',avisos:[]},icms:{tipo:'NEGADO',creditoIcms:0,observacao:'Relatorio de despesas: ICMS nao aplicavel.',fundamentoLegal:'N/A',avisos:[]}};});const tot=det.reduce((a,d)=>{a.creditoPIS+=d.pisCofins.creditoPIS||0;a.creditoCOFINS+=d.pisCofins.creditoCOFINS||0;a.notasAnalisadas++;const tp=d.pisCofins.tipo,k='total'+tp[0]+tp.slice(1).toLowerCase();if(a.resumo.pisCofins[k]!==undefined)a.resumo.pisCofins[k]++;return a;},{creditoPIS:0,creditoCOFINS:0,creditoIcms:0,notasAnalisadas:0,resumo:{pisCofins:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0},icms:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0}}});tot.creditoTotal=+(tot.creditoPIS+tot.creditoCOFINS).toFixed(2);const base=det.filter(d=>d.pisCofins.tipo==='APROVADO').reduce((s,d)=>s+d.nota.valorTotal,0);return{resultado:{totais:tot,detalhes:det,alertas:[{nivel:'info',mensagem:det.length+' categorias de despesa analisadas.'},{nivel:'info',mensagem:'Base aprovada: R$ '+base.toLocaleString('pt-BR',{minimumFractionDigits:2})+' | PIS: R$ '+tot.creditoPIS.toFixed(2)+' | COFINS: R$ '+tot.creditoCOFINS.toFixed(2)}]}};}
// ---------------------------------------------------------------------------
function calcularResultado(notas, regime) {
    const detalhes = notas.map(nota => ({ nota, pisCofins: analisarPisCofins(nota, regime), icms: analisarIcms(nota) }));
    const totais = detalhes.reduce((acc, d) => {
        acc.creditoPIS    += d.pisCofins.creditoPIS||0;
        acc.creditoCOFINS += d.pisCofins.creditoCOFINS||0;
        acc.creditoIcms   += d.icms.creditoIcms||0;
        const tp = d.pisCofins.tipo, ti = d.icms.tipo;
        const k = t => 'total' + t[0] + t.slice(1).toLowerCase();
        if (tp && acc.resumo.pisCofins[k(tp)] !== undefined) acc.resumo.pisCofins[k(tp)]++;
        if (ti && acc.resumo.icms[k(ti)] !== undefined) acc.resumo.icms[k(ti)]++;
        return acc;
    }, { creditoPIS:0, creditoCOFINS:0, creditoIcms:0, notasAnalisadas:notas.length,
         resumo:{ pisCofins:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0},
                  icms:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0} } });
    totais.creditoTotal = +(totais.creditoPIS + totais.creditoCOFINS + totais.creditoIcms).toFixed(2);
    const alertas = [];
    if (regime === 'LUCRO_REAL' && totais.creditoTotal > 0)
        alertas.push({ nivel:'info', mensagem:'Créditos calculados com PIS 1,65% e COFINS 7,6% (Lucro Real não cumulativo).' });
    if (detalhes.some(d => d.pisCofins.tipo==='REVISAR'||d.icms.tipo==='REVISAR'))
        alertas.push({ nivel:'alerta', mensagem:'Algumas notas necessitam revisão manual — consulte o contador.' });
    return { totais, detalhes, alertas };
}
function parseNFeXml(xml) {
    const notas = [];
    const nNF = xmlTag(xml, 'nNF');
    const natOp = xmlTag(xml, 'natOp');
    const xNome = xmlTag(xml, 'xNome');
    const detRegex = /<det\b[^>]*>([\s\S]*?)<\/det>/g;
    let m;
    while ((m = detRegex.exec(xml)) !== null) {
        const det = m[1];
        const cstM = det.match(/<CST>([^<]+)<\/CST>/) || det.match(/<CSOSN>([^<]+)<\/CSOSN>/);
        const vICMSm = det.match(/<vICMS>([^<]+)<\/vICMS>/);
        notas.push({
            numero: nNF, emitente: xNome, cfop: xmlTag(det,'CFOP'),
            cst: cstM ? cstM[1] : '', natureza: natOp,
            valorTotal: parseFloat(xmlTag(det,'vProd'))||0,
            baseCalculo: parseFloat(xmlTag(det,'vBC'))||0,
            valorIcms: vICMSm ? parseFloat(vICMSm[1])||0 : 0,
            aliquotaIcms: 0, tipo: 'PRODUTO'
        });
    }
    return notas;
}
function parseCsv(text) {
    const linhas = text.split('\n').filter(l => l.trim());
    if (linhas.length < 2) return [];
    const sep = linhas[0].includes(';') ? ';' : linhas[0].includes('\t') ? '\t' : ',';
    const headers = linhas[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g,''));
    return linhas.slice(1).map((linha, i) => {
        const cols = linha.split(sep);
        const row = {};
        headers.forEach((h,j) => row[h] = (cols[j]||'').trim().replace(/['"]/g,''));
        const n = k => parseFloat((row[k]||'0').replace(',','.'))||0;
        return { numero:row['numero']||row['nf']||String(i+1), emitente:row['emitente']||'',
                 cfop:row['cfop']||'', cst:row['cst']||'', natureza:row['natureza']||row['nat.op']||'',
                 valorTotal:n('valor total')||n('valortotal')||n('valor')||n('valor_total'),
                 baseCalculo:n('base calculo')||n('base')||n('base_calculo'),
                 valorIcms:n('valor icms')||n('icms')||n('valor_icms'),
                 aliquotaIcms:n('aliq icms')||n('aliquota')||0, tipo:'PRODUTO' };
    });
}
app.post('/api/analise-creditos/manual', async (req, res) => {
    try {
        const { notas, perfilCliente } = req.body;
        if (!Array.isArray(notas)||!notas.length||!perfilCliente)
            return res.status(400).json({ erro:'Dados incompletos' });
        return res.json({ resultado: calcularResultado(notas, perfilCliente.regime) });
    } catch(err) { return res.status(500).json({ erro: err.message||'Erro interno' }); }
});
app.post('/api/analise-creditos/upload', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro:'Arquivo não enviado' });
        const perfil = JSON.parse(req.body.perfil||'{}');
        const nome2=req.file.originalname.toLowerCase();const regime=perfil.regime||'LUCRO_REAL_SERVICOS';if(nome2.endsWith('.xlsx')||nome2.endsWith('.xls')){const g=parseXlsxExpense(req.file.buffer);if(!g)return res.status(400).json({erro:'Arquivo sem dados de despesas. Verifique colunas TIPO DE DESPESA e VALOR.'});return res.json(calcularCreditoExpense(g,regime));}
const conteudo = req.file.buffer.toString('utf-8');
        const nome = req.file.originalname.toLowerCase();
        let notas = [];
        if (nome.endsWith('.xml')) {
            notas = parseNFeXml(conteudo);
        } else {
            notas = parseCsv(conteudo);
        }
        if (!notas.length) return res.status(400).json({ erro:'Nenhuma nota encontrada no arquivo' });
        return res.json({ resultado: calcularResultado(notas, regime) });
    } catch(err) { return res.status(500).json({ erro: err.message||'Erro ao processar arquivo' }); }
});
// ────────────────────────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist'), { maxAge: '1y', index: 'index.html' }));
app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
