// ============================================================================
// sefaz-backend/leiaute-guia-extrator.js  (PURO — testável)
//
// Lê a tabela de leiaute de cada registro no Guia Prático da EFD-Contribuições
// e devolve a CONTAGEM DE CAMPOS. Mora aqui, e não no script, porque script
// `.mjs` não carrega no jest — e régua sem prova é o vício que esta casa já
// pagou (o E116, o E250, a varredura de campo órfão que virou script e sumiu).
//
// Quem chama: `scripts/extrair-leiaute-contrib.mjs`, que só faz o I/O.
// ============================================================================

/** Início de cada seção de registro — o índice tem o nº da página no fim. */
const CABECALHO = /^Registro ([0-9A-Z]{4,5}):/;
const SO_NUMERO = /^\|\s*(\d{2})\s*$/;
// ⚠️ O nome do campo QUEBRA no meio na extração do Word ("VL_BC_COFIN S",
// "COD_ NAT_CC"), então o espaço interno é aceito e removido depois.
const SO_NOME = /^\|\s*([A-Z][A-Z0-9_ ]{1,25})\s*$/;

export function extrairLeiaute(texto) {
    const linhas = String(texto || '').split('\n');
    const secoes = [];
    linhas.forEach((l, i) => {
        const m = CABECALHO.exec(l.trim());
        if (m && !/\t\d+\s*$/.test(l)) secoes.push({ i, reg: m[1] });
    });

    const registros = {};
    secoes.forEach(({ i: ini, reg }, k) => {
        const fim = k + 1 < secoes.length ? secoes[k + 1].i : linhas.length;
        const campos = new Map();
        for (let j = ini; j < fim - 1; j += 1) {
            const num = SO_NUMERO.exec(linhas[j].trim());
            const nome = num && SO_NOME.exec(linhas[j + 1].trim());
            if (!num || !nome) continue;
            const n = Number(num[1]);
            if (!campos.has(n)) campos.set(n, nome[1].replace(/\s+/g, ''));
        }
        if (campos.get(1) !== 'REG') return;
        const ultimo = Math.max(...campos.keys());
        const buracos = [];
        for (let n = 1; n <= ultimo; n += 1) if (!campos.has(n)) buracos.push(n);
        // Registro já lido antes (o Guia repete alguns): fica o mais completo.
        const antes = registros[reg];
        if (antes && antes.campos >= ultimo) return;
        registros[reg] = {
            campos: ultimo,
            // Buraco = número que se perdeu na conversão do .docx. A contagem
            // pode estar SUBESTIMADA, então quem consome trata como incerta.
            incerto: buracos.length > 0,
            buracos,
            nomes: Array.from({ length: ultimo }, (_, x) => campos.get(x + 1) || '?'),
        };
    });
    return registros;
}
