// ============================================================================
// 🚨 493 ERROS DE "CÓDIGO DE PARTICIPANTE" NAS ENTRADAS — e o C100 saía VAZIO
//
// Paulo, 11/09, testando o SPED de uma distribuidora: *"deu erros de cod de
// participante nas entradas … 493 só de código de participante"*.
//
// MEDIDO rodando o gerador (não deduzido): a entrada capturada pela SEFAZ
// chega ACHATADA (`cnpjEmit`, `xNomeEmit`, `codMunEmit`) e o dono
// `participanteDoDocumento` lia só a forma ANINHADA (`emitente`). O
// EFD-Contribuições normalizava a nota ANTES de chamá-lo (21/08); o EFD
// ICMS/IPI não — então o C100 saía `|C100|0|1||55|…|` (COD_PART vazio) e o
// coletor do 0150 recebia null e PULAVA o participante. Um erro por nota de
// entrada: 493 notas. A PWR (20/08) passou porque as entradas dela tinham
// entrado pelo NAVEGADOR, que grava o objeto.
//
// É a armadilha das DUAS FORMAS pela enésima vez — desta vez dentro do próprio
// dono, que existe para fechá-la.
// ============================================================================
import { participanteDoDocumento, codPartDoDocumento } from '../sefaz-backend/participante-doc-helper.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirCodPartDoC100 } from '../sefaz-backend/sped-c100-regras-comuns.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';

// CNPJs FICTÍCIOS — dado de cliente não entra no repo.
const EMPRESA = '11111111000191';
const FORN = '22222222000191';
const CHAVE = '35260822222222000191550010000001001000000019';

const entradaAchatada = (over: Record<string, unknown> = {}) => ({
    id: 'a', chave: CHAVE, numero: '100', serie: '1', modelo: '55', tipo: 'NFe', tipoDoc: 'NFe',
    direcao: 'entrada', tpNF: '1', status: 'autorizado', dhEmi: '2026-08-10T10:00:00-03:00', competencia: '2026-08',
    empresaId: 'e', empresaCnpj: EMPRESA,
    cnpjEmit: FORN, xNomeEmit: 'FORNECEDOR ACHATADO', ufEmit: 'SP', codMunEmit: '3550308', ieEmit: '123',
    cnpjDest: EMPRESA, xNomeDest: 'DISTRIBUIDORA',
    itens: [{ nItem: '1', cProd: 'P1', xProd: 'A', cfop: '5102', cst: '000', vProd: 100, qCom: 1, uCom: 'UN', vBC: 100, vICMS: 18, aliqIcms: 18 }],
    totais: { vNF: 100, vProd: 100, vBC: 100, vICMS: 18 },
    ...over,
});

describe('🚨 participanteDoDocumento lê as DUAS formas', () => {
    it('entrada ACHATADA: a contraparte é o emitente, com município e IE', () => {
        const p: any = participanteDoDocumento(entradaAchatada(), EMPRESA);
        expect(p).not.toBeNull();
        expect(p.cnpjCpf).toBe(FORN);
        expect(p.nome).toBe('FORNECEDOR ACHATADO');
        expect(p.codMunIBGE).toBe('3550308');
        expect(codPartDoDocumento(entradaAchatada(), EMPRESA)).toBe(FORN);
    });

    it('a forma ANINHADA continua respondendo igual (nada regride)', () => {
        const p: any = participanteDoDocumento({
            direcao: 'entrada', emitente: { cnpjCpf: FORN, nome: 'X', codMunIBGE: '3550308' },
        }, EMPRESA);
        expect(p.cnpjCpf).toBe(FORN);
    });

    it('saída ACHATADA: a contraparte é o destinatário', () => {
        const p: any = participanteDoDocumento({
            direcao: 'saida', cnpjEmit: EMPRESA, xNomeEmit: 'EU', cnpjDest: '33333333000191', xNomeDest: 'CLIENTE',
        }, EMPRESA);
        expect(p.cnpjCpf).toBe('33333333000191');
    });

    it('nota PRÓPRIA de entrada achatada (art. 136): a contraparte é o destinatário', () => {
        const p: any = participanteDoDocumento({
            direcao: 'saida', tpNF: '0', cnpjEmit: EMPRESA, xNomeEmit: 'EU',
            cnpjDest: '12345678909', xNomeDest: 'PRODUTOR RURAL',
        }, EMPRESA);
        expect(p.cnpjCpf).toBe('12345678909');
    });

    it('documento sem lado nenhum devolve null — ausência não se inventa', () => {
        expect(participanteDoDocumento({ direcao: 'entrada' }, EMPRESA)).toBeNull();
        expect(codPartDoDocumento({ direcao: 'entrada' }, EMPRESA)).toBe('');
    });
});

describe('🚨 o C100 do EFD ICMS/IPI da entrada achatada sai COM o participante', () => {
    const dados = (notas: any[]) => ({
        empresa: { cnpj: EMPRESA, nome: 'DISTRIBUIDORA', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'LUCRO_PRESUMIDO' } },
        notas, competencia: '2026-08', periodoInicio: '2026-08-01', periodoFim: '2026-08-31', warnings: [] as string[],
    });

    it('COD_PART = CNPJ do fornecedor (era VAZIO — a linha medida em 11/09)', () => {
        const r: any = buildBlocoC(dados([entradaAchatada()]));
        const c100 = (r.linhas || r).find((l: string) => l.startsWith('|C100|'));
        expect(c100.split('|')[4]).toBe(FORN);
    });
});

describe('🚦 a regra do C100 sem COD_PART, nas DUAS famílias', () => {
    const l = (c: string[]) => `|${c.join('|')}|\r\n`;
    const c100 = (indEmit: string, codPart: string, codMod = '55') =>
        l(['C100', '0', indEmit, codPart, codMod, '00', '001', '100', CHAVE, '10082026', '10082026', '100,00']);
    const r0150 = (cod: string) => l(['0150', cod, 'FORN', '1058', cod, '', '', '3550308', '', '', '', '', '']);

    it('terceiro sem COD_PART é acusado, com a ação (reler o XML)', () => {
        const e = conferirCodPartDoC100([c100('1', '')]);
        expect(e).toHaveLength(1);
        expect(e[0].regra).toBe('c100-sem-cod-part');
        expect(e[0].acao).toMatch(/Reler participante/);
        expect(e[0].fonte).toMatch(/Guia Prático 3\.2\.3/);
    });

    it('COD_PART que o 0150 não declara é acusado; declarado, silêncio', () => {
        expect(conferirCodPartDoC100([c100('1', FORN)]).map((e: any) => e.regra)).toEqual(['c100-cod-part-fora-do-0150']);
        expect(conferirCodPartDoC100([r0150(FORN), c100('1', FORN)])).toEqual([]);
    });

    it('NFC-e (65) e emissão própria (IND_EMIT 0) NÃO são acusadas pelo vazio', () => {
        expect(conferirCodPartDoC100([c100('1', '', '65')])).toEqual([]);
        expect(conferirCodPartDoC100([c100('0', '')])).toEqual([]);
    });

    it('roda no EFD ICMS/IPI', () => {
        const z = l(['0000', '020', '0', '01082026', '31082026', 'X', EMPRESA, '', 'SP', '1', '3550308', '', '', 'A', '1']);
        const r = prevalidarSpedFiscal([z, c100('1', '')]);
        expect(r.erros.some((x: any) => x.regra === 'c100-sem-cod-part')).toBe(true);
    });

    it('e no EFD-Contribuições', () => {
        const z = l(['0000', '006', '0', '', '', '01082026', '31082026', 'X', EMPRESA, 'SP', '3550308', '', '00', '1']);
        expect(avisosDaPrevalidacaoContrib([z, c100('1', '')]).join(' ')).toMatch(/sem COD_PART/);
    });
});
