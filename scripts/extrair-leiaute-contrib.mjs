#!/usr/bin/env node
// ============================================================================
// scripts/extrair-leiaute-contrib.mjs
//
// Lê o Guia Prático da EFD-Contribuições (o .txt extraído em `docs/sped/`) e
// gera a CONTAGEM DE CAMPOS por registro, direto da fonte oficial.
//
// ═══ POR QUE EXISTE ═════════════════════════════════════════════════════════
//
// A trava de contagem (`CAMPOS_POR_REGISTRO`) roda em todo arquivo gerado, mas
// só acusa o registro que está NELA — e até 25/08 ela tinha ONZE, todos vindos
// de recibo do PVA ou de arquivo assinado. Os outros 28 que o gerador emite
// passavam sem conferência: foi assim que o 0500 saiu com 9 campos onde o
// leiaute do arquivo VIZINHO tem 9 e o desta família tem outro leiaute.
//
// Com o Guia no repo (25/08), a contagem dos 200 registros vira dado — e o que
// era silêncio vira conferência.
//
//   node scripts/extrair-leiaute-contrib.mjs
//
// ⚠️ **O RECIBO CONTINUA VENCENDO.** Este arquivo é derivado de uma extração
// mecânica de .docx, e a extração ERRA: no 0500 o número do campo 09 se perdeu
// na conversão, e a contagem sai 8 onde o assinado do CF BANK mostra 9. Por
// isso `CAMPOS_POR_REGISTRO` mescla com precedência **recibo/assinado > Guia**,
// e a divergência entre os dois sai NOMEADA em vez de escolhida em silêncio.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const FONTE = path.resolve('docs/sped/guia-pratico-efd-contribuicoes-1.35.txt');
const DESTINO = path.resolve('docs/sped/leiaute-efd-contribuicoes-1.35.json');
// O backend importa o MÓDULO (sem I/O, para o núcleo continuar puro e testável).
const MODULO = path.resolve('sefaz-backend/leiaute-contrib-guia.js');

import { extrairLeiaute } from '../sefaz-backend/leiaute-guia-extrator.js';

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!fs.existsSync(FONTE)) {
        console.error(`Fonte não encontrada: ${FONTE}`);
        process.exit(1);
    }
    const registros = extrairLeiaute(fs.readFileSync(FONTE, 'utf8'));
    const total = Object.keys(registros).length;
    const incertos = Object.values(registros).filter((r) => r.incerto).length;
    fs.writeFileSync(DESTINO, `${JSON.stringify({
        fonte: 'Guia Prático da EFD-Contribuições, versão 1.35 (18/06/2021) — docs/sped/',
        gerado_por: 'scripts/extrair-leiaute-contrib.mjs',
        registros,
    }, null, 1)}\n`);
    // O módulo leva só o que a trava usa — a contagem dos registros CERTOS.
    const certos = Object.entries(registros)
        .filter(([, r]) => !r.incerto)
        .sort(([a], [b]) => a.localeCompare(b));
    const incertosNomes = Object.entries(registros)
        .filter(([, r]) => r.incerto).map(([k]) => k).sort();
    fs.writeFileSync(MODULO, [
        '// ============================================================================',
        '// sefaz-backend/leiaute-contrib-guia.js  — GERADO, não editar à mão.',
        '//',
        '//   node scripts/extrair-leiaute-contrib.mjs',
        '//',
        '// Contagem de campos por registro do EFD-Contribuições, extraída do Guia',
        '// Prático 1.35 (docs/sped/). A contagem INCLUI o REG, que é como o PVA conta.',
        '//',
        '// ⚠️ Só entram os registros cuja leitura da tabela ficou COMPLETA. Onde o',
        '// número de um campo se perdeu na conversão do .docx a contagem pode estar',
        '// subestimada, e acusar por ela seria alarme sobre registro certo — então',
        '// esses ficam de FORA, nomeados em `REGISTROS_INCERTOS_NO_GUIA`.',
        '// ============================================================================',
        '',
        '/** REG → nº de campos (incluindo o REG). */',
        'export const CAMPOS_DO_GUIA = Object.freeze({',
        ...certos.map(([k, r]) => `    '${k}': ${r.campos},`),
        '});',
        '',
        '/** Registros cuja tabela não foi lida por inteiro — a contagem NÃO é usada. */',
        'export const REGISTROS_INCERTOS_NO_GUIA = Object.freeze([',
        `    ${incertosNomes.map((k) => `'${k}'`).join(', ')},`,
        ']);',
        '',
    ].join('\n'));
    console.log(`✓ ${total} registros → ${path.relative(process.cwd(), DESTINO)}`);
    console.log(`  ${certos.length} completos → ${path.relative(process.cwd(), MODULO)}`);
    console.log(`  ${incertos} com número perdido na conversão, tratados como INCERTOS.`);
}
