// ============================================================================
// sefaz-backend/leiaute-guia-extrator.js  (PURO — testável)
//
// Lê a tabela de leiaute de cada registro nos Guias Práticos do SPED e devolve
// a CONTAGEM DE CAMPOS. Mora aqui, e não no script, porque script `.mjs` não
// carrega no jest — e régua sem prova é o vício que esta casa já pagou (o
// E116, o E250, a varredura de campo órfão que virou script e sumiu).
//
// Quem chama: `scripts/extrair-leiaute-contrib.mjs` e
// `scripts/extrair-leiaute-fiscal.mjs`, que só fazem o I/O.
//
// ═══ UM ALGORITMO, DOIS DIALETOS ════════════════════════════════════════════
//
// A PERGUNTA é a mesma nos dois Guias ("quantos campos tem este registro?") —
// o que muda é como o .docx foi convertido para texto:
//
//   · EFD-Contribuições 1.35 : `Registro 0500:` e o nº de campo SEMPRE com `|`
//   · EFD ICMS/IPI 3.2.3     : `REGISTRO 0500:` e o nº de campo às vezes SEM
//     o `|` (a conversão quebra a célula em `\n\n14\n | COD_MU N`)
//
// ⚠️ **E O DIALETO NÃO SE UNIFICOU "de lambuja"**: relaxar a leitura do
// Contribuições MUDA a tabela dele em **15 registros**, numa trava que já roda
// em produção — mexer nisso junto com outra coisa é trocar alarme por alarme
// sem ninguém medir.
//
// ✅ **A revisão veio DEPOIS, com medição própria, e o gabarito autorizou**:
// contra os **11 registros provados por recibo do PVA / arquivo assinado**, a
// leitura estrita acertava **10** e a tolerante acerta **11** — o que ela
// conserta é justamente o **0500**, que a estrita lia em 8 e o assinado do CF
// BANK prova em **9**. A cobertura subiu de 184 para **199** registros e a
// `divergenciasGuiaXRecibo()` continua vazia.
//
// 📌 **REGRA QUE FICA: mudança em trava viva se autoriza contra o GABARITO da
// própria trava.** Sem ele, isto seria "parece melhor" — que é como se afrouxa
// uma trava sem perceber.
// ============================================================================

/**
 * Dialeto do Guia da EFD-Contribuições 1.35.
 *
 * ✅ **A leitura tolerante entrou aqui MEDIDA contra o gabarito**, não por
 * simetria com a outra família: contra os **11 registros provados por recibo
 * do PVA / arquivo assinado**, a leitura estrita acertava **10** e a tolerante
 * acerta **11** — o que ela conserta é justamente o **0500**, que a estrita
 * lia em 8 e o assinado do CF BANK prova em **9**. A cobertura sobe de 184
 * para 199 registros.
 *
 * ⚠️ E dos 15 registros cuja leitura muda, só **três** são emitidos pelo
 * gerador — 0100 (14 nos dois, só sai de incerto), A100 (21 nos dois, idem) e
 * o 0500, que MELHORA. Os outros (D505, C181, C185, D300, D501, F500, I299,
 * 1100, A110) o app não emite: a mudança neles não altera comportamento hoje.
 */
const CONTRIB = {
    // Início de cada seção — o índice tem o nº da página no fim.
    cabecalho: /^Registro ([0-9A-Z]{4,5}):/,
    soNumero: /^\|?\s*(\d{2})\s*$/,
    // ⚠️ O nome do campo QUEBRA no meio na extração do Word ("VL_BC_COFIN S",
    // "COD_ NAT_CC"), então o espaço interno é aceito e removido depois — e
    // pode vir ACENTUADO (o campo 05 do 0500 é "NÍVEL").
    soNome: /^\|?\s*([A-ZÀ-Ú][A-ZÀ-Ú0-9_ ]{1,25})\s*$/,
    vaziasEntre: 2,
};

/** Dialeto do Guia Prático do EFD ICMS/IPI 3.2.3. */
const FISCAL = {
    // ⚠️ Aqui o cabeçalho aparece NO MEIO da linha — a conversão gruda o
    // título do bloco no do registro (`BLOCO C: … REGISTRO C001: ABERTURA…`),
    // e foi só por isso que o **C001 não tinha tabela nenhuma**. Acontece em 8
    // registros (0002, B001, C001, C160, D510, D750, E310, 1800).
    // A guarda é a ASPA: no histórico de alterações o Guia CITA títulos
    // (`o título do registro C195 passa para: “REGISTRO C195: …”`), e casar ali
    // criaria uma seção falsa que corta a seção verdadeira ao meio.
    cabecalho: /(?:^|[^“"])REGISTRO ([0-9A-Z]{4,5}):/,
    // 🚨 O `|` é OPCIONAL aqui, e não é preciosismo: foi exatamente ele que
    // fez a leitura do **0100 parar no campo 13** — a conversão soltou o `14`
    // numa linha sem pipe. E o pior é que a sequência 01..13 ficava CONTÍGUA,
    // então o registro saía marcado como *conferido* com um campo a menos: a
    // trava acusaria o 0100 de TODA empresa, num registro CERTO.
    soNumero: /^\|?\s*(\d{2})\s*$/,
    // ⚠️ E o nome de campo pode vir ACENTUADO: o campo 05 do 0500 é **NÍVEL**,
    // e era só isso que deixava o registro marcado como incerto — o buraco não
    // estava na conversão, estava no meu regex. Corrigir a CLASSE (aceitar o
    // acento) em vez da instância (ler o 0500 à mão) é a régua da casa.
    soNome: /^\|?\s*([A-ZÀ-Ú][A-ZÀ-Ú0-9_ ]{1,25})\s*$/,
    // 🚨 E aqui a conversão separa o número do nome com uma linha VAZIA ou só
    // com o `|` — foi assim que o **G001** saiu com 1 campo em vez de 2 (REG +
    // IND_MOV), de novo com a sequência contígua e marcado como conferido.
    // Duas linhas de folga bastam para os casos do Guia e não alcançam o campo
    // seguinte, que é o risco de pular demais.
    vaziasEntre: 2,
};

function lerTabelas(texto, dialeto) {
    const linhas = String(texto || '').split('\n');
    const secoes = [];
    linhas.forEach((l, i) => {
        const m = dialeto.cabecalho.exec(l);
        if (m && !/\t\d+\s*$/.test(l)) secoes.push({ i, reg: m[1] });
    });

    const registros = {};
    secoes.forEach(({ i: ini, reg }, k) => {
        const fim = k + 1 < secoes.length ? secoes[k + 1].i : linhas.length;
        const campos = new Map();
        const folga = dialeto.vaziasEntre || 0;
        for (let j = ini; j < fim - 1; j += 1) {
            const num = dialeto.soNumero.exec(linhas[j].trim());
            if (!num) continue;
            // A linha do NOME vem logo abaixo; onde o dialeto permite, pula as
            // linhas vazias (ou só com `|`) que a conversão intercalou.
            let p = j + 1;
            for (let g = 0; g < folga && p < fim && /^\|?\s*$/.test(linhas[p].trim()); g += 1) p += 1;
            const nome = p < fim && dialeto.soNome.exec(linhas[p].trim());
            if (!nome) continue;
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

/** Guia Prático da EFD-Contribuições 1.35. */
export function extrairLeiaute(texto) {
    return lerTabelas(texto, CONTRIB);
}

/** Guia Prático do EFD ICMS/IPI 3.2.3. */
export function extrairLeiauteFiscal(texto) {
    return lerTabelas(texto, FISCAL);
}
