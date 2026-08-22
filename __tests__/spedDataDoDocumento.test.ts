// ============================================================================
// 🚨 A NOTA EMITIDA ÀS 22h SAÍA NO SPED COM A DATA DO DIA SEGUINTE
//
// O `dhEmi` da NF-e chega com o fuso do EMITENTE:
// `2026-07-31T22:30:00-03:00`. O formatador fazia `new Date(...)` e lia
// `getUTCDate()` — e às 22h30 de Brasília, em UTC, já é o dia seguinte.
//
// O backend roda no Cloud Run, cujo fuso é UTC. Então o defeito era ATIVO, e
// de duas gravidades:
//
//   · nota emitida depois das 21h saía com a data do dia SEGUINTE — errado, e
//     ninguém confere data a olho;
//   · na VIRADA DO MÊS ela saía com a data de OUTRA competência, e aí o PVA
//     recusa (Guia 3.2.3, C100 campo 10: DT_DOC ≤ DT_FIN do 0000).
//
// A data que o documento fiscal DECLARA é a do texto — `2026-07-31`. Converter
// para outro fuso é reescrever o que a nota diz.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

describe('🚨 a data do documento é a do EMITENTE, não a de UTC', () => {
    it('nota das 22h30 fica no MESMO dia', () => {
        expect(fmt.formatDate('2026-07-10T22:30:00-03:00')).toBe('10072026');
    });

    // 🔴 O caso caro: a virada do mês joga a nota para outra competência.
    it('nota das 22h30 do dia 31 NÃO vira dia 1º do mês seguinte', () => {
        expect(fmt.formatDate('2026-07-31T22:30:00-03:00')).toBe('31072026');
    });

    it('a nota da manhã continua igual — a correção não mexe no caso comum', () => {
        expect(fmt.formatDate('2026-07-10T10:00:00-03:00')).toBe('10072026');
    });

    it('data sem hora e data brasileira também respondem', () => {
        expect(fmt.formatDate('2026-07-05')).toBe('05072026');
        expect(fmt.formatDate('05/07/2026')).toBe('05072026');
    });

    // Campo fiscal não recebe chute: sem data legível, sai VAZIO.
    it('o que não é data legível sai VAZIO, nunca "hoje"', () => {
        expect(fmt.formatDate('')).toBe('');
        expect(fmt.formatDate('ontem')).toBe('');
        expect(fmt.formatDate(null)).toBe('');
    });

    // Firestore Timestamp era descartado em silêncio — e data vazia no C100 é
    // recusa do PVA.
    it('Timestamp do Firestore não some em silêncio', () => {
        const ts = { toDate: () => new Date('2026-07-05T12:00:00Z') };
        expect(fmt.formatDate(ts)).toBe('05072026');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A REDE: o erro é de DATA, e ninguém confere data a olho. A regra é do Guia,
// não deduzida — e só o limite SUPERIOR, porque documento EXTEMPORÂNEO (de mês
// anterior, escriturado agora) é legítimo e acusá-lo seria alarme falso.
// ═══════════════════════════════════════════════════════════════════════════
const linha = (campos: string[]) => `|${campos.join('|')}|\r\n`;

const arquivo = (dtDoc: string) => [
    linha(['0000', '020', '0', '01072026', '31072026', 'X LTDA', '31947349000169', '', 'SP', '123', '3550308', '', '', 'A', '1']),
    linha(['C100', '0', '1', 'P1', '55', '00', '001', '3485', '3'.repeat(44), dtDoc, dtDoc, '1000,00']),
];

describe('🚨 R16 — DT_DOC depois do fim do período', () => {
    it('acusa a nota que caiu no mês seguinte', () => {
        const r = prevalidarSpedFiscal(arquivo('01082026'));
        const e = r.erros.find((x: any) => x.regra === 'dt-doc-fora-do-periodo');
        expect(e).toBeDefined();
        expect(e!.esperado).toBe('≤ 31072026');
        expect(e!.fonte).toContain('Guia Prático');
    });

    it('não acusa a nota dentro do período', () => {
        const r = prevalidarSpedFiscal(arquivo('31072026'));
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });

    // ⚠️ EXTEMPORÂNEA É LEGÍTIMA: o Guia não exige DT_DOC ≥ DT_INI no C100.
    // Acusá-la faria a trava gritar sobre escrituração correta.
    it('e NÃO acusa documento extemporâneo, de mês anterior', () => {
        const r = prevalidarSpedFiscal(arquivo('15062026'));
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });

    it('sem 0000 legível a regra fica MUDA, em vez de acusar no escuro', () => {
        const r = prevalidarSpedFiscal([linha(['C100', '0', '1', 'P1', '55', '00', '001', '3485', '3'.repeat(44), '01082026', '01082026', '1000,00'])]);
        expect(r.erros.some((x: any) => x.regra === 'dt-doc-fora-do-periodo')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O `.FML` TINHA O MESMO DEFEITO — e discordar do SPED é o que custa caro
//
// O Exportar SAGE formatava a data a partir de um `Date`, com `getFullYear`/
// `getMonth`/`getDate` — ou seja, no fuso de QUEM ESTÁ RODANDO. Ali o defeito
// é mais discreto (o .FML sai do navegador do colaborador, em BRT), mas basta
// a nota vir de outro fuso — Manaus, -04:00, emitida às 23h30 — para o dia
// andar. E aí o **SPED declara 31/07 e o `.FML` 01/08 para a MESMA nota**.
//
// A trava é sobre a RESPOSTA, não sobre o código: os dois formatadores moram
// em mundos diferentes (o do SPED é backend `.js` sem `.d.ts`, e criar um só
// para partilhar cinco linhas traria de volta a armadilha do `.d.ts` à mão,
// 20/08). O que a casa precisa é que eles digam o MESMO DIA — e é isso que
// esta comparação prova, entrada por entrada.
// ═══════════════════════════════════════════════════════════════════════════
import { dataDeclaradaAAAAMMDD, participanteDoDoc } from '../services/iobSageExportService';

describe('🚨 SPED e .FML declaram o MESMO dia', () => {
    const casos = [
        '2026-07-31T22:30:00-03:00',   // o caso caro: vira o mês em UTC
        '2026-07-10T22:30:00-03:00',
        '2026-07-10T23:30:00-04:00',   // Manaus — o fuso que o BRT também erra
        '2026-07-10T10:00:00-03:00',
        '2026-07-05',
        '05/07/2026',
    ];

    it.each(casos)('%s', (bruto) => {
        const ddmmaaaa = fmt.formatDate(bruto);           // SPED: DDMMAAAA
        const aaaammdd = dataDeclaradaAAAAMMDD(bruto);    // .FML: AAAAMMDD
        expect(aaaammdd).toHaveLength(8);
        // Mesma data, formatos espelhados.
        expect(aaaammdd.slice(6, 8) + aaaammdd.slice(4, 6) + aaaammdd.slice(0, 4)).toBe(ddmmaaaa);
    });

    it('o ilegível sai VAZIO nos dois — data não se chuta', () => {
        for (const lixo of ['', 'ontem', null as any]) {
            expect(fmt.formatDate(lixo)).toBe('');
            expect(dataDeclaradaAAAAMMDD(lixo)).toBe('');
        }
    });
});

describe('🚨 nota sem data legível fica de FORA do .FML, nomeada', () => {
    const nota = (dhEmi: any) => ({
        id: 'x', numero: '3485', serie: '1', tipo: 'NFe', modelo: '55',
        chave: '35260731947349000169550010000034853106861510',
        dhEmi, direcao: 'entrada', status: 'autorizado',
        cnpjEmit: '12345678000199', xNomeEmit: 'FORNECEDOR LTDA', ufEmit: 'SP',
        emitente: { cnpjCpf: '12345678000199', nome: 'FORNECEDOR LTDA', uf: 'SP' },
        totais: { vNF: 1000 },
        itens: [{ cfop: '1102', vProd: 1000 }],
    }) as any;

    // A régua da casa: ausência bloqueia e é DITA. O `|| new Date()` anterior
    // escriturava a nota no dia da GERAÇÃO — na virada do mês, outra
    // competência, e o E-Fiscal aceita sem dizer nada.
    it('o participante continua legível (a nota é montável, o que falta é a data)', () => {
        expect(participanteDoDoc(nota('2026-07-10T10:00:00-03:00'))?.cnpjCpf).toBe('12345678000199');
    });

    it('e o gerador RECUSA a nota sem data, com a ação na frase', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exportarParaIobSage } = require('../services/iobSageExportService');
        const r = exportarParaIobSage({ documentos: [nota(null)], numeroEmpresaEfiscal: 1 });
        const f = r.falhas.find((x: any) => /data de emissão/i.test(x.motivo));
        expect(f).toBeDefined();
        expect(f.motivo).toMatch(/HOJE/);
        expect(f.motivo).toMatch(/♻️|Reimporte/);
    });

    it('com data legível ela entra normalmente', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exportarParaIobSage } = require('../services/iobSageExportService');
        const r = exportarParaIobSage({ documentos: [nota('2026-07-10T10:00:00-03:00')], numeroEmpresaEfiscal: 1 });
        expect(r.falhas.some((x: any) => /data de emissão/i.test(x.motivo))).toBe(false);
        expect(r.conteudo).toContain('20260710');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A CLASSE SÓ FECHA COM VARREDURA — o teste cruzado prova os DOIS que eu
// conhecia; ele não impede o TERCEIRO
//
// Em 22/08 o gerador do SPED e o do `.FML` foram corrigidos e travados por um
// teste que alimenta os dois com as mesmas entradas e exige o MESMO DIA. Isso
// prova o que existe — e não vê quem nasce depois. A varredura achou o
// terceiro: o **relatório de análise de XMLs do SAGE** lia
// `new Date(dhEmi).toLocaleDateString('pt-BR')`, ou seja *"que dia era no fuso
// de QUEM ABRIU A TELA"* — e é justamente ele que o colaborador compara com o
// arquivo.
//
// ✂️ A leitura virou UMA (`dataDeclaradaDoDocumento`, na casa das leituras de
// documento), e cada lugar só TRADUZ para a forma dele. A decisão de 22/08 era
// não criar um módulo novo para partilhar cinco linhas por causa da armadilha
// do `.d.ts` à mão — o obstáculo sumiu ao pôr a régua onde o `.d.ts` já existe.
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { dataDeclaradaDoDocumento } from '../sefaz-backend/xml-metadata-helper.js';

const RAIZ_APP = join(__dirname, '..');

describe('🚨 o DONO da data lê o TEXTO, nunca o fuso', () => {
    it('a nota das 22h30 de Brasília declara 31/07, não 01/08', () => {
        expect(dataDeclaradaDoDocumento('2026-07-31T22:30:00-03:00')).toBe('2026-07-31');
    });

    // O caso que o BRT também erra — foi ele que mostrou que "acertar por
    // acidente" não é acertar.
    it('e a de Manaus às 23h30 declara 31/07 igual', () => {
        expect(dataDeclaradaDoDocumento('2026-07-31T23:30:00-04:00')).toBe('2026-07-31');
    });

    it('lê a forma brasileira de colagem e de cadastro manual', () => {
        expect(dataDeclaradaDoDocumento('05/08/2026')).toBe('2026-08-05');
    });

    it('Timestamp do Firestore não vira data VAZIA', () => {
        const ts = { toDate: () => new Date(Date.UTC(2026, 6, 10, 12)) };
        expect(dataDeclaradaDoDocumento(ts)).toBe('2026-07-10');
    });

    // ⚠️ Campo de data NÃO recebe default: ausência devolve vazio, e quem
    // escreve decide se bloqueia (o SPED e o `.FML` bloqueiam).
    it('ausência e lixo devolvem vazio, nunca a data de hoje', () => {
        for (const x of [null, undefined, '', 'abc', {}]) {
            expect(dataDeclaradaDoDocumento(x)).toBe('');
        }
    });
});

describe('🚨 ninguém mais lê a data do documento por conversão de fuso', () => {
    // ⚠️ Assinatura ESTREITA: só `new Date(<campo de data de documento>)`
    // seguido de leitura de DIA/MÊS. Cálculo de IDADE (`getTime()`) é outra
    // pergunta e não casa — trava que grita sobre código certo é trava
    // desligada.
    const PROIBIDO = /new Date\([^)]*(dhEmi|dataEmissao|dtEmi|dEmi|dataFatoGerador)[^)]*\)\s*\.\s*(getDate|getUTCDate|getMonth|getUTCMonth|getFullYear|getUTCFullYear|toLocaleDateString|toLocaleString)/;

    const DECLARADOS: Record<string, string> = {
        // O DONO é o único que pode: ele existe justamente para converter o
        // que já perdeu o fuso (Date/Timestamp), e faz isso em UTC declarado.
        'sefaz-backend/xml-metadata-helper.js': 'é o dono da régua',
    };

    const arquivos = (dir: string, out: string[] = []): string[] => {
        for (const nome of readdirSync(dir)) {
            if (nome === 'node_modules' || nome.startsWith('.')) continue;
            const caminho = join(dir, nome);
            if (statSync(caminho).isDirectory()) { arquivos(caminho, out); continue; }
            if (/\.(ts|tsx|js)$/.test(nome) && !nome.endsWith('.d.ts')) out.push(caminho);
        }
        return out;
    };

    it('varre o código de produção (varredura vazia é trava falsa)', () => {
        const todos = ['components', 'services', 'sefaz-backend'].flatMap(p => arquivos(join(RAIZ_APP, p)));
        expect(todos.length).toBeGreaterThan(100);
    });

    it('nenhum leitor novo converte o fuso para descobrir o DIA', () => {
        const infratores: string[] = [];
        for (const p of ['components', 'services', 'sefaz-backend']) {
            for (const arquivo of arquivos(join(RAIZ_APP, p))) {
                const rel = relative(RAIZ_APP, arquivo).replace(/\\/g, '/');
                if (DECLARADOS[rel]) continue;
                // Prosa não é código — a mesma decisão da varredura de órfãs.
                const src = readFileSync(arquivo, 'utf8')
                    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
                if (PROIBIDO.test(src)) infratores.push(rel);
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 DATA DE DOCUMENTO LIDA POR CONVERSÃO DE FUSO\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO `dhEmi` chega com o fuso do EMITENTE. `new Date(...)` + `getDate()`/\n'
                + '`toLocaleDateString()` responde "que dia era no MEU fuso naquele instante" —\n'
                + 'outra pergunta. O backend roda no Cloud Run (UTC) e a nota das 22h ia com a\n'
                + 'data do dia seguinte; na VIRADA DO MÊS ela cai em outra competência e o PVA\n'
                + 'recusa. Fora da virada, a data sai errada e ninguém confere data a olho.\n\n'
                + 'Use `dataDeclaradaDoDocumento` (sefaz-backend/xml-metadata-helper.js) e\n'
                + 'traduza para a forma do seu arquivo/tela.\n',
            );
        }
    });
});
