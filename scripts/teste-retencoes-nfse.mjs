// scripts/teste-retencoes-nfse.mjs
// Smoke test: parseia o CSV de exemplo e mostra retencoes detectadas.
// Uso: node scripts/teste-retencoes-nfse.mjs <caminho-do-csv>

import { readFileSync } from 'fs';
// Reaproveita as funcoes do servico TS via dynamic ts-eval seria pesado;
// reimplemento aqui as 3 funcoes minimas. Como o objetivo eh validar
// regex/heuristicas, replicar aqui evita compilacao.

const REGEX_IBPT = /(?:trib(?:utos?)?\s+aprox|fonte\s+ibpt|lei\s+12\.?741|carga\s+tribut[áa]ria\s+aprox)/i;
const REGEX_EMITENTE_RECOLHEU = /recolhimento\s+(?:j[áa]\s+)?efetuado\s+pelo\s+emitente/i;

function parseValorBR(s) {
    if (!s) return 0;
    const txt = String(s).replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(txt)) return parseFloat(txt.replace(/\./g, '').replace(',', '.'));
    if (/,\d{1,2}$/.test(txt)) return parseFloat(txt.replace(/\./g, '').replace(',', '.'));
    return parseFloat(txt.replace(/,/g, '')) || 0;
}

function detectar(texto, tributoRegex) {
    if (!texto) return { retido: false, valor: 0 };
    const matchNaoReten = texto.match(/(?:n[ãa]o\s+reten[^.|]{0,80})/i);
    if (matchNaoReten && tributoRegex.test(matchNaoReten[0])) {
        return { retido: false, valor: 0, motivo: 'nao retencao explicita', trecho: matchNaoReten[0].trim().slice(0, 80) };
    }
    const regexComRS = new RegExp(`(${tributoRegex.source})[^|\\n]{0,80}?R\\$\\s*([0-9]+(?:[.,][0-9]+)*)`, 'gi');
    let m;
    while ((m = regexComRS.exec(texto)) !== null) {
        const trecho = texto.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
        if (REGEX_IBPT.test(trecho)) continue;
        if (REGEX_EMITENTE_RECOLHEU.test(trecho)) {
            return { retido: false, valor: 0, motivo: 'recolhido pelo emitente', trecho: m[0].trim().slice(0, 80) };
        }
        const valor = parseValorBR(m[2]);
        if (valor > 0) return { retido: true, valor, trecho: m[0].trim().slice(0, 80) };
        return { retido: false, valor: 0, motivo: 'mencionado R$ 0', trecho: m[0].trim().slice(0, 80) };
    }
    return { retido: false, valor: 0 };
}

function splitLinha(l) {
    const out = []; let cur = ''; let aspas = false;
    for (const c of l) {
        if (c === '"') { aspas = !aspas; continue; }
        if (c === ';' && !aspas) { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

const caminho = process.argv[2];
if (!caminho) { console.error('uso: node scripts/teste-retencoes-nfse.mjs <csv>'); process.exit(1); }

const txt = readFileSync(caminho, 'utf8').replace(/^﻿/, '');
const linhas = [];
let buf = '', aspas = false;
for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (c === '"') aspas = !aspas;
    if ((c === '\n' || c === '\r') && !aspas) {
        if (buf.length) linhas.push(buf);
        buf = '';
        if (c === '\r' && txt[i + 1] === '\n') i++;
    } else buf += c;
}
if (buf.length) linhas.push(buf);

const header = splitLinha(linhas[0]).map(h => h.toLowerCase());
const idx = {
    direcao: header.findIndex(h => h.startsWith('direç') || h.startsWith('direc')),
    numero: header.findIndex(h => h.startsWith('número') || h.startsWith('numero')),
    data: header.findIndex(h => h === 'data'),
    valorServicos: header.findIndex(h => h.includes('valor') && h.includes('serv')),
    iss: header.findIndex(h => h === 'iss'),
    tomadorNome: header.findIndex(h => h.includes('tomador') && h.includes('nome')),
    prestadorNome: header.findIndex(h => h.includes('prestador') && h.includes('nome')),
    discriminacao: header.findIndex(h => h.startsWith('discrim')),
};

const resumo = {
    total: 0, comRetencao: 0,
    iss: { qtd: 0, valor: 0 }, inss: { qtd: 0, valor: 0 },
    pis: { qtd: 0, valor: 0 }, cofins: { qtd: 0, valor: 0 },
    csll: { qtd: 0, valor: 0 }, irrf: { qtd: 0, valor: 0 },
};
const exemplos = []; // primeiras 8 com retencao

for (let i = 1; i < linhas.length; i++) {
    const cols = splitLinha(linhas[i]);
    if (cols.length < 5) continue;
    const iss = parseValorBR(cols[idx.iss] || '0');
    const disc = cols[idx.discriminacao] || '';
    const r = {
        iss: iss > 0 ? { retido: true, valor: iss } : { retido: false, valor: 0 },
        irrf: detectar(disc, /\bIRRF\b/),
        pis: detectar(disc, /\bPIS\b/),
        cofins: detectar(disc, /\bCOFINS\b/),
        csll: detectar(disc, /\bCSLL\b/),
        inss: detectar(disc, /\bINSS\b/),
    };
    resumo.total++;
    const algum = ['iss', 'irrf', 'pis', 'cofins', 'csll', 'inss'].some(k => r[k].retido);
    if (algum) resumo.comRetencao++;
    for (const k of ['iss', 'irrf', 'pis', 'cofins', 'csll', 'inss']) {
        if (r[k].retido) { resumo[k].qtd++; resumo[k].valor += r[k].valor; }
    }
    if (algum && exemplos.length < 10) {
        exemplos.push({
            numero: cols[idx.numero], direcao: cols[idx.direcao],
            valor: parseValorBR(cols[idx.valorServicos]),
            tomador: cols[idx.tomadorNome]?.slice(0, 40),
            prestador: cols[idx.prestadorNome]?.slice(0, 40),
            retencoes: Object.fromEntries(
                ['iss', 'irrf', 'pis', 'cofins', 'csll', 'inss']
                    .filter(k => r[k].retido)
                    .map(k => [k, r[k].valor])
            ),
        });
    }
}

console.log('=== RESUMO ===');
console.log(JSON.stringify(resumo, null, 2));
console.log('\n=== PRIMEIRAS 10 NOTAS COM RETENCAO ===');
console.log(JSON.stringify(exemplos, null, 2));
