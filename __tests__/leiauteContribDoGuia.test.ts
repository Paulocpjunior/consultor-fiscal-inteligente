// ============================================================================
// 🚨 A CONTAGEM DE CAMPOS DEIXOU DE COBRIR 11 REGISTROS E PASSOU A COBRIR 33
//
// A trava de contagem roda em todo arquivo gerado desde 18/08 — mas **só acusa
// o registro que está NELA**, e até 25/08 ela tinha ONZE, todos vindos de
// recibo do PVA ou de arquivo assinado. Os outros 28 que o gerador emite
// passavam sem conferência nenhuma: foi assim que o 0500 saiu com o leiaute do
// arquivo VIZINHO e só o olho do Paulo pegou ("uma está com 4 barrinhas e a
// outra com 3").
//
// Com o Guia Prático 1.35 no repo (Paulo mandou o Word em 25/08), a contagem
// dos 200 registros virou dado — extraída por script, não escrita à mão.
//
// ⚠️ E O RECIBO CONTINUA VENCENDO: a extração de .docx erra (no 0500 o número
// do campo 09 se perdeu na conversão). Recibo do PVA é a régua FALANDO;
// extração é leitura de documento.
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
import {
    CAMPOS_POR_REGISTRO, CAMPOS_PROVADOS_POR_RECIBO, divergenciasGuiaXRecibo,
    REGISTROS_SEM_CONTAGEM, conferirContagemDeCampos,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/sped-contrib-campos.js';
import {
    CAMPOS_DO_GUIA, REGISTROS_INCERTOS_NO_GUIA,
// @ts-ignore
} from '../sefaz-backend/leiaute-contrib-guia.js';

const raiz = (...p: string[]) => path.resolve(__dirname, '..', ...p);

describe('🚨 o Guia cobre o que o recibo não alcançava', () => {
    it('a tabela conferida é MUITO maior que as onze provadas', () => {
        expect(Object.keys(CAMPOS_PROVADOS_POR_RECIBO)).toHaveLength(11);
        expect(Object.keys(CAMPOS_POR_REGISTRO).length).toBeGreaterThan(150);
    });

    // 🚨 A PRECEDÊNCIA É O CORAÇÃO DISTO. O 0500 é o caso vivo: o Guia extraído
    // diz 8 (o número do campo 09 se perdeu na conversão) e o assinado do CF
    // BANK mostra 9. Se o Guia vencesse, a trava acusaria a linha CORRETA.
    it('o provado por recibo/assinado VENCE o Guia', () => {
        for (const [reg, d] of Object.entries(CAMPOS_PROVADOS_POR_RECIBO) as [string, any][]) {
            expect(CAMPOS_POR_REGISTRO[reg].campos).toBe(d.campos);
            expect(CAMPOS_POR_REGISTRO[reg].fonte).toBe(d.fonte);
        }
        expect(CAMPOS_POR_REGISTRO['0500'].campos).toBe(9);
    });

    // ⚠️ Registro cuja tabela não foi lida por inteiro fica de FORA: a contagem
    // pode estar subestimada, e acusar por ela é alarme sobre registro certo —
    // o jeito conhecido de a equipe desligar a trava.
    it('registro com número perdido na conversão NÃO entra', () => {
        expect(REGISTROS_INCERTOS_NO_GUIA.length).toBeGreaterThan(0);
        for (const reg of REGISTROS_INCERTOS_NO_GUIA) {
            expect(CAMPOS_DO_GUIA[reg]).toBeUndefined();
        }
        expect(REGISTROS_SEM_CONTAGEM).toBe(REGISTROS_INCERTOS_NO_GUIA);
    });

    // 🚨 NASCE VERDE. Entrada aqui é ACHADO: ou a extração falhou, ou o Guia e
    // o PVA discordam — e as duas coisas pedem olho humano, não escolha em
    // silêncio.
    it('Guia e recibo não discordam hoje', () => {
        expect(divergenciasGuiaXRecibo()).toEqual([]);
    });

    it('cada contagem carrega a FONTE — nenhuma foi escrita de memória', () => {
        for (const reg of Object.keys(CAMPOS_POR_REGISTRO)) {
            expect(String(CAMPOS_POR_REGISTRO[reg].fonte)).toMatch(/PVA|ACEITO|Guia Prático/);
        }
    });
});

describe('🚨 os registros que o gerador EMITE estão cobertos', () => {
    // As contagens conferidas contra os arquivos reais de dois clientes — o da
    // PWR (indústria, bloco C) e o da HYPE (varejo, NFC-e).
    const EMITIDOS: Record<string, number> = {
        '0000': 14, '0001': 2, '0100': 14, '0110': 5, '0140': 9, '0150': 13,
        '0190': 3, '0200': 12, '0990': 2, '1001': 2, '1990': 2, '9001': 2,
        '9900': 3, '9990': 2, '9999': 2, A001: 2, A990: 2, C001: 2, C010: 3,
        C100: 29, C170: 37, C990: 2, D001: 2, D990: 2, F001: 2, F990: 2,
        M001: 2, M200: 13, M205: 4, M210: 16, M600: 13, M605: 4, M610: 16,
        M990: 2,
    };

    it('a contagem do Guia bate com a que o gerador emite, registro a registro', () => {
        const semCobertura: string[] = [];
        for (const [reg, n] of Object.entries(EMITIDOS)) {
            const esperado = CAMPOS_POR_REGISTRO[reg]?.campos;
            if (esperado == null) { semCobertura.push(reg); continue; }
            expect([reg, esperado]).toEqual([reg, n]);
        }
        // ✅ 29/08: com a leitura tolerante do Guia (medida contra o gabarito
        // de recibo, onde ela acerta 11/11 e a estrita acertava 10), o **0100
        // saiu da lista** — e com ele o último descoberto. Os 34 registros que
        // o gerador emite estão TODOS cobertos, e cada contagem bate com a que
        // os arquivos reais da PWR e da HYPE mostram.
        expect(semCobertura).toEqual([]);
    });

    // 🚨 A PROVA QUE VALE: os arquivos REAIS dos dois clientes passam limpos.
    // Trava nova que nasce vermelha é trava que a equipe desliga.
    it('nasce VERDE sobre um arquivo real inteiro', () => {
        const linhas = [
            '|0000|006|0|||01072026|31072026|PWR|31947349000169|SP|3507605||00|0|',
            '|0110|2||1|9|',
            '|C010|31947349000169|2|',
            '|C100|1|0|26767102000120|55|00|001|7|3526|24072026|24072026|18179,00|0|562,24'
                + '||18741,24|9|0,00|0,00|0,00|18179,00|3272,22|0,00|0,00|0,00|121,82|562,24|||',
        // ⚠️ Os quatro `0,00` são os campos de AJUSTE (5, 6, 12, 13): eles saíam
        // VAZIOS e o PVA recusou com "Campo de preenchimento obrigatório"
        // (DGB, 28/08). Sem M220/M620 não há ajuste, e aqui o zero É a
        // resposta. Quantidade (9-10) e diferimento (14-15) seguem vazios —
        // esses o PVA não acusou.
            '|M210|51|38316,84|30958,77|0,00|0,00|30958,77|0,6500|||201,23|0,00|0,00|||201,23|',
            '|M205|12|810902|201,23|',
            '|9999|113|',
        ];
        const r = conferirContagemDeCampos(linhas);
        expect(r.erros).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('e continua acusando o registro torto — a trava não afrouxou', () => {
        // O M210 recusado pelo PVA em 18/08: 8 campos onde o leiaute tem 16.
        const r = conferirContagemDeCampos(['|M210|01|43890,00|0,6500|||285,28||']);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].esperado).toBe(16);
    });
});

// 🚨 O MÓDULO É GERADO. Editado à mão, ele vira uma SEGUNDA cópia do Guia — e
// cópia de tabela oficial é o que esta casa mais paga.
describe('🚨 o leiaute é derivado do Guia, não digitado', () => {
    it('o módulo diz que é gerado e aponta o script', () => {
        const src = fs.readFileSync(raiz('sefaz-backend/leiaute-contrib-guia.js'), 'utf8');
        expect(src).toContain('GERADO, não editar à mão');
        expect(src).toContain('scripts/extrair-leiaute-contrib.mjs');
    });

    it('o script e a fonte oficial estão no repo — a próxima versão se regera', () => {
        expect(fs.existsSync(raiz('scripts/extrair-leiaute-contrib.mjs'))).toBe(true);
        expect(fs.existsSync(raiz('docs/sped/guia-pratico-efd-contribuicoes-1.35.txt'))).toBe(true);
    });

    // ⚠️ Sem isto, alguém "conserta" uma contagem no módulo gerado e ela some
    // no próximo `node scripts/extrair-leiaute-contrib.mjs`.
    it('regerar do Guia produz exatamente o módulo que está no repo', async () => {
        // ⚠️ A régua mora no BACKEND, não no script: `.mjs` não carrega no jest,
        // e régua sem prova é o vício que esta casa já pagou.
        // @ts-ignore — módulo JS do backend, sem tipos
        const { extrairLeiaute } = await import('../sefaz-backend/leiaute-guia-extrator.js');
        const guia = fs.readFileSync(raiz('docs/sped/guia-pratico-efd-contribuicoes-1.35.txt'), 'utf8');
        const registros = extrairLeiaute(guia) as Record<string, { campos: number; incerto: boolean }>;
        const certos = Object.entries(registros).filter(([, r]) => !r.incerto);
        expect(certos).toHaveLength(Object.keys(CAMPOS_DO_GUIA).length);
        for (const [reg, r] of certos) expect([reg, CAMPOS_DO_GUIA[reg]]).toEqual([reg, r.campos]);
    });
});
