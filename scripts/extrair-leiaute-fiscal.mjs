#!/usr/bin/env node
// ============================================================================
// scripts/extrair-leiaute-fiscal.mjs
//
// Lê o Guia Prático do EFD ICMS/IPI 3.2.3 (o .txt em `docs/sped/`) e gera a
// CONTAGEM DE CAMPOS por registro, direto da fonte oficial.
//
// ═══ POR QUE EXISTE ═════════════════════════════════════════════════════════
//
// A trava de contagem de campos existia **só no EFD-Contribuições**. O EFD
// ICMS/IPI — o arquivo que a PWR fechou em 20/08, com 35+ registros de
// conteúdo — não tinha NENHUMA: é a "meia trava" do COD_MUN do 0150 (22/08),
// que protege uma família e deixa a outra descoberta.
//
// E a classe que ela pega já custou recibo TRÊS vezes: o 1010 com 9 campos
// onde o leiaute tem 7 (17/08), o C100/C170 com 24/23 onde têm 29/37 (20/08,
// 157 recusas de uma vez) e o 0500 com o leiaute do arquivo VIZINHO (24/08,
// achado a olho pelo Paulo contando as barras na tela).
//
//   node scripts/extrair-leiaute-fiscal.mjs
//
// ⚠️ **RECIBO/ARQUIVO ACEITO CONTINUA VENCENDO.** Isto é derivado de uma
// extração mecânica de .docx, e ela ERRA: no 0100 o número do campo 14 saiu
// numa linha sem `|` e a leitura parava em 13 — com a sequência CONTÍGUA, ou
// seja marcada como conferida. A trava acusaria o 0100 de toda empresa.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const FONTE = path.resolve('docs/sped/guia-pratico-efd-icms-ipi-3.2.3.txt');
const DESTINO = path.resolve('docs/sped/leiaute-efd-icms-ipi-3.2.3.json');
// O backend importa o MÓDULO (sem I/O, para o núcleo continuar puro e testável).
const MODULO = path.resolve('sefaz-backend/leiaute-fiscal-guia.js');

import { extrairLeiauteFiscal } from '../sefaz-backend/leiaute-guia-extrator.js';

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!fs.existsSync(FONTE)) {
        console.error(`Fonte não encontrada: ${FONTE}`);
        process.exit(1);
    }
    const registros = extrairLeiauteFiscal(fs.readFileSync(FONTE, 'utf8'));
    const total = Object.keys(registros).length;
    fs.writeFileSync(DESTINO, `${JSON.stringify({
        fonte: 'Guia Prático da Escrituração Fiscal Digital ICMS/IPI, versão 3.2.3 — docs/sped/',
        gerado_por: 'scripts/extrair-leiaute-fiscal.mjs',
        registros,
    }, null, 1)}\n`);
    const certos = Object.entries(registros)
        .filter(([, r]) => !r.incerto)
        .sort(([a], [b]) => a.localeCompare(b));
    const incertosNomes = Object.entries(registros)
        .filter(([, r]) => r.incerto).map(([k]) => k).sort();
    fs.writeFileSync(MODULO, [
        '// ============================================================================',
        '// sefaz-backend/leiaute-fiscal-guia.js  — GERADO, não editar à mão.',
        '//',
        '//   node scripts/extrair-leiaute-fiscal.mjs',
        '//',
        '// Contagem de campos por registro do EFD ICMS/IPI, extraída do Guia Prático',
        '// 3.2.3 (docs/sped/). A contagem INCLUI o REG, que é como o PVA conta.',
        '//',
        '// ⚠️ Só entram os registros cuja leitura da tabela ficou COMPLETA. Onde o',
        '// número de um campo se perdeu na conversão do .docx a contagem pode estar',
        '// subestimada, e acusar por ela seria alarme sobre registro certo — então',
        '// esses ficam de FORA, nomeados em `REGISTROS_INCERTOS_NO_GUIA_FISCAL`.',
        '// ============================================================================',
        '',
        '/** REG → nº de campos (incluindo o REG). */',
        'export const CAMPOS_DO_GUIA_FISCAL = Object.freeze({',
        ...certos.map(([k, r]) => `    '${k}': ${r.campos},`),
        '});',
        '',
        '/** Registros cuja tabela não foi lida por inteiro — a contagem NÃO é usada. */',
        'export const REGISTROS_INCERTOS_NO_GUIA_FISCAL = Object.freeze([',
        `    ${incertosNomes.map((k) => `'${k}'`).join(', ')},`,
        ']);',
        '',
        '/**',
        ' * TAMANHO máximo por POSIÇÃO de campo (índice 0 = campo 01, o REG).',
        ' *',
        ' * ⚠️ `null` = campo de tamanho LIVRE no Guia (todo campo de valor) ou não',
        ' * lido — quem consome NÃO confere nesses. Conferir ali seria inventar limite.',
        ' *',
        ' * 📌 O tamanho é indexado pelo NÚMERO do campo, não pela ordem de leitura,',
        ' * então um campo perdido na conversão não desloca os vizinhos: ele só vira',
        ' * `null`.',
        ' */',
        'export const TAMANHOS_DO_GUIA_FISCAL = Object.freeze({',
        ...Object.entries(registros)
            .sort(([a], [b]) => a.localeCompare(b))
            .filter(([, r]) => (r.tamanhos || []).some((t) => t != null))
            .map(([k, r]) => `    '${k}': [${(r.tamanhos || []).map((t) => (t == null ? 'null' : t)).join(', ')}],`),
        '});',
        '',
    ].join('\n'));
    console.log(`✓ ${total} registros → ${path.relative(process.cwd(), DESTINO)}`);
    console.log(`  ${certos.length} completos → ${path.relative(process.cwd(), MODULO)}`);
    console.log(`  ${total - certos.length} com número perdido na conversão, tratados como INCERTOS.`);
}
