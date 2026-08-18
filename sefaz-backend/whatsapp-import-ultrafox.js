// ============================================================================
// sefaz-backend/whatsapp-import-ultrafox.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// RESTAURAÇÃO DO BACKUP DA ULTRA FOX (Paulo, 16/08): contatos e mensagens
// entram no SP Connect a partir do export da plataforma antiga.
//
// DECISÕES QUE MANDAM:
// - O formato EXATO do export da Ultra Fox não está documentado, então o
//   parser casa coluna pelo TEXTO do cabeçalho (o padrão do parser do
//   Jotform, calibrado em produção) e aceita ',', ';' e TAB — o export de
//   NFS-e do portal ensinou que ler UM delimitador devolve zero linha EM
//   SILÊNCIO. Mensagens também entram pelo .txt padrão de export de conversa
//   do WhatsApp (formato público e estável).
// - NADA é gravado sem PREVIEW: a rota devolve a leitura e só grava com
//   confirmar:true (mesmo desenho da consulta de prazo municipal).
// - Linha ilegível NUNCA some muda: vai contada com o MOTIVO (contador mudo
//   é o que faz alguém achar que importou tudo).
// - Data ilegível NÃO vira "agora": mensagem sem data legível é descartada
//   nomeada — data errada é pior que data que explode (16/08).
// - A DIREÇÃO da mensagem do .txt não se adivinha: o preview lista os
//   AUTORES e quem confirma diz quais são do escritório (viram 'saida').
// ============================================================================

import { createHash } from 'crypto';
import { normalizarNumeroBr } from './whatsapp-cloud.js';

// ─── CSV genérico (delimitador detectado, aspas respeitadas) ────────────────

export function detectarDelimitador(linhaCabecalho) {
    const conta = (ch) => (String(linhaCabecalho || '').match(new RegExp(`\\${ch}`, 'g')) || []).length;
    const candidatos = [[';', conta(';')], [',', conta(',')], ['\t', (String(linhaCabecalho || '').match(/\t/g) || []).length]];
    candidatos.sort((a, b) => b[1] - a[1]);
    return candidatos[0][1] > 0 ? candidatos[0][0] : ';';
}

function dividirLinha(linha, delim) {
    const campos = [];
    let atual = '';
    let dentroDeAspas = false;
    for (let i = 0; i < linha.length; i += 1) {
        const c = linha[i];
        if (c === '"') {
            if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i += 1; } else dentroDeAspas = !dentroDeAspas;
        } else if (c === delim && !dentroDeAspas) {
            campos.push(atual); atual = '';
        } else {
            atual += c;
        }
    }
    campos.push(atual);
    return campos.map((c) => c.trim());
}

export function interpretarCsv(texto) {
    const linhas = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!linhas.length) return { cabecalho: [], linhas: [] };
    const delim = detectarDelimitador(linhas[0]);
    const cabecalho = dividirLinha(linhas[0], delim).map((c) => c.toLowerCase());
    return { cabecalho, linhas: linhas.slice(1).map((l) => dividirLinha(l, delim)) };
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function acharColuna(cabecalho, regex) {
    return cabecalho.findIndex((c) => regex.test(semAcento(c)));
}

// ─── Contatos ───────────────────────────────────────────────────────────────

/**
 * Lê um CSV de contatos casando as colunas pelo texto do cabeçalho.
 * Devolve {contatos, descartados, avisos} — descartado leva o MOTIVO.
 */
export function interpretarContatosCsv(texto) {
    const { cabecalho, linhas } = interpretarCsv(texto);
    const avisos = [];
    if (!cabecalho.length) return { contatos: [], descartados: [], avisos: ['Arquivo vazio ou sem cabeçalho.'] };

    // Empresa é testada ANTES do nome: "nome da empresa" casa os dois padrões.
    const colEmpresa = acharColuna(cabecalho, /empresa|company|organiza/);
    const colNumero = acharColuna(cabecalho, /telefone|celular|whats|numero|number|phone|fone/);
    const colNome = cabecalho.findIndex((c, i) => i !== colEmpresa && /nome|name|contato|cliente/.test(semAcento(c)));
    if (colNumero < 0) {
        return {
            contatos: [],
            descartados: [],
            avisos: [`Nenhuma coluna de NÚMERO reconhecida no cabeçalho (${cabecalho.join(' · ')}). O parser procura telefone/celular/whatsapp/número.`],
        };
    }
    if (colNome < 0) avisos.push('Nenhuma coluna de NOME reconhecida — os contatos entram só com o número.');

    const porNumero = new Map();
    const descartados = [];
    linhas.forEach((l, i) => {
        const bruto = l[colNumero] || '';
        const numero = normalizarNumeroBr(bruto);
        if (!numero) {
            descartados.push({ linha: i + 2, valor: bruto, motivo: 'número ilegível (não é fixo nem celular BR)' });
            return;
        }
        const nome = colNome >= 0 ? (l[colNome] || '').trim() : '';
        const empresa = colEmpresa >= 0 ? (l[colEmpresa] || '').trim() : '';
        const jaTem = porNumero.get(numero);
        // Duplicata no arquivo: fica o PRIMEIRO com nome (e o fato vai contado).
        if (jaTem) {
            if (!jaTem.nome && nome) jaTem.nome = nome;
            jaTem.duplicatasNoArquivo = (jaTem.duplicatasNoArquivo || 0) + 1;
            return;
        }
        porNumero.set(numero, { numero, nome: nome || null, empresaNome: empresa || null });
    });
    return { contatos: [...porNumero.values()], descartados, avisos };
}

// ─── Datas (fuso de SP — Ultra Fox exporta hora local) ──────────────────────

/** 'DD/MM/AAAA HH:MM[:SS]' (ou AA) → ISO UTC. Ilegível → null, NUNCA "agora". */
export function dataBrParaIso(dataStr, horaStr) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(dataStr || '').trim());
    const h = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(horaStr || '').trim());
    if (!d || !h) return null;
    const ano = d[3].length === 2 ? `20${d[3]}` : d[3];
    const pad = (x) => String(x).padStart(2, '0');
    // SP é UTC-03:00 fixo desde 2019 (sem horário de verão).
    const iso = `${ano}-${pad(d[2])}-${pad(d[1])}T${pad(h[1])}:${h[2]}:${h[3] || '00'}-03:00`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ─── Conversa .txt (formato de export do WhatsApp) ──────────────────────────

// Aceita `16/08/2026 14:32 - Nome: texto` e `[16/08/2026, 14:32:05] Nome: texto`.
const LINHA_MSG = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*([^:]{1,80}):\s?([\s\S]*)$/;

/**
 * Lê um export .txt de conversa. A DIREÇÃO não é decidida aqui: devolve as
 * mensagens com o AUTOR e a lista de autores — quem confirma diz quais são
 * do escritório.
 */
export function interpretarConversaTxt(texto) {
    const linhas = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const mensagens = [];
    const descartadas = [];
    const autores = new Set();
    for (const linha of linhas) {
        if (!linha.trim()) continue;
        const m = LINHA_MSG.exec(linha);
        if (m) {
            const em = dataBrParaIso(m[1], m[2]);
            if (!em) { descartadas.push({ trecho: linha.slice(0, 60), motivo: 'data ilegível' }); continue; }
            const autor = m[3].trim();
            autores.add(autor);
            mensagens.push({ em, autor, texto: m[4] });
        } else if (mensagens.length && !/^\[?\d{1,2}\/\d{1,2}\/\d{2,4}/.test(linha)) {
            // Continuação de mensagem multi-linha.
            mensagens[mensagens.length - 1].texto += `\n${linha}`;
        } else {
            descartadas.push({ trecho: linha.slice(0, 60), motivo: 'linha fora do formato (aviso de sistema?)' });
        }
    }
    return { mensagens, autores: [...autores], descartadas };
}

// ─── Mensagens em CSV (export tabular) ──────────────────────────────────────

const DIRECAO_ENTRADA = /entrada|recebid|\bin\b|cliente/;
const DIRECAO_SAIDA = /saida|enviad|\bout\b|atendente|operador|agente/;

export function interpretarMensagensCsv(texto) {
    const { cabecalho, linhas } = interpretarCsv(texto);
    const avisos = [];
    if (!cabecalho.length) return { mensagens: [], descartadas: [], avisos: ['Arquivo vazio ou sem cabeçalho.'] };
    const colData = acharColuna(cabecalho, /data|date|quando/);
    const colHora = acharColuna(cabecalho, /^hora|time/);
    const colNumero = acharColuna(cabecalho, /telefone|celular|whats|numero|number|phone|fone/);
    const colDirecao = acharColuna(cabecalho, /direcao|tipo|sentido/);
    const colTexto = acharColuna(cabecalho, /mensagem|texto|conteudo|message|body/);
    const faltando = [
        colData < 0 && 'data', colNumero < 0 && 'número', colTexto < 0 && 'mensagem',
    ].filter(Boolean);
    if (faltando.length) {
        return { mensagens: [], descartadas: [], avisos: [`Colunas não reconhecidas no cabeçalho (${cabecalho.join(' · ')}): faltou ${faltando.join(', ')}.`] };
    }
    if (colDirecao < 0) avisos.push('Sem coluna de direção — todas entram como ENTRADA (mensagem do cliente).');

    const mensagens = [];
    const descartadas = [];
    linhas.forEach((l, i) => {
        const numero = normalizarNumeroBr(l[colNumero] || '');
        if (!numero) { descartadas.push({ linha: i + 2, motivo: `número ilegível (${l[colNumero] || 'vazio'})` }); return; }
        // Data pode vir junta ("16/08/2026 14:32") ou em colunas separadas.
        const brutoData = (l[colData] || '').trim();
        const [soData, soHora] = brutoData.includes(' ') ? brutoData.split(/\s+/, 2) : [brutoData, colHora >= 0 ? l[colHora] : ''];
        const em = dataBrParaIso(soData, soHora) || (Number.isFinite(Date.parse(brutoData)) ? new Date(Date.parse(brutoData)).toISOString() : null);
        if (!em) { descartadas.push({ linha: i + 2, motivo: `data ilegível (${brutoData || 'vazia'})` }); return; }
        const dir = colDirecao >= 0 ? semAcento(l[colDirecao]) : 'entrada';
        const direcao = DIRECAO_SAIDA.test(dir) ? 'saida' : DIRECAO_ENTRADA.test(dir) ? 'entrada'
            : colDirecao >= 0 ? null : 'entrada';
        if (!direcao) { descartadas.push({ linha: i + 2, motivo: `direção desconhecida (${l[colDirecao]})` }); return; }
        mensagens.push({ numero, em, direcao, texto: l[colTexto] || '' });
    });
    return { mensagens, descartadas, avisos };
}

// ─── Id determinístico (reimportar NÃO duplica) ─────────────────────────────

/**
 * 🚨 A CHAVE NÃO PODE LEVAR `direcao` — achado ao ler o print do Paulo
 * escolhendo autores num lote de 1.851 conversas (18/08). A `direcao` é
 * DERIVADA de quem foi marcado como escritório; o `autor` é o dado BRUTO do
 * arquivo, e ele é o que identifica a mensagem de verdade.
 *
 * Se a chave levasse `direcao`: marcar um autor errado, confirmar, perceber o
 * erro e reimportar com a marcação certa não corrigiria nada — mudaria a
 * `direcao` e, com ela, o próprio id, então a mensagem antiga (com a direção
 * ERRADA) ficaria PARA SEMPRE na conversa, e uma segunda, com a direção
 * certa, entraria do lado dela. A pessoa acabaria com a mesma frase duas
 * vezes, uma "enviada" e outra "recebida" — pior que o erro original, porque
 * agora ninguém sabe qual das duas é a real.
 *
 * A chave usa `autor` quando ele existe (import de .txt, que é onde a
 * classificação pode ser refeita); sem autor (import de CSV, que já traz a
 * direção PRONTA da coluna) ela cai em `direcao`, que ali É o dado bruto.
 */
export function idMensagemImportada({ numero, em, direcao, texto, autor }) {
    const chaveVariavel = autor != null ? `autor:${autor}` : `direcao:${direcao}`;
    const h = createHash('sha1').update(`${numero}|${em}|${chaveVariavel}|${texto}`).digest('hex');
    return `uf_${h}`;
}

/** Monta os docs prontos pra gravação a partir do .txt + escolha de autores. */
export function prepararMensagensDoTxt({ mensagens, numero, autoresEscritorio = [] }) {
    const escritorio = new Set(autoresEscritorio.map((a) => String(a).trim().toLowerCase()));
    return mensagens.map((m) => {
        const direcao = escritorio.has(String(m.autor).trim().toLowerCase()) ? 'saida' : 'entrada';
        return { numero, em: m.em, direcao, texto: m.texto, autor: m.autor };
    });
}
