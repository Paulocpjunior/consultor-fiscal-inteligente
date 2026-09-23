/** Funções puras usadas na prévia do navegador e no importador do backend. */
export function dataBrParaIso(dataStr, horaStr) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(dataStr || '').trim());
    const h = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(horaStr || '').trim());
    if (!d || !h) return null;
    const ano = d[3].length === 2 ? `20${d[3]}` : d[3];
    const pad = (x) => String(x).padStart(2, '0');
    const iso = `${ano}-${pad(d[2])}-${pad(d[1])}T${pad(h[1])}:${h[2]}:${h[3] || '00'}-03:00`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const LINHA_MSG = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*([^:]{1,80}):\s?([\s\S]*)$/;

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
            mensagens[mensagens.length - 1].texto += `\n${linha}`;
        } else {
            descartadas.push({ trecho: linha.slice(0, 60), motivo: 'linha fora do formato (aviso de sistema?)' });
        }
    }
    return { mensagens, autores: [...autores], descartadas };
}
