// ============================================================================
// 📒 O REGISTRO DE APURAÇÃO DO ICMS (RAICMS) SAI DA MESMA APURAÇÃO DO E110.
//
// 14/09, Paulo, HYPE CAFÉ · Lucro Presumido · 08/2026, com o print do e-Fiscal:
// *"crie um relatório conforme modelo acima, porque por exemplo, o valor de
// difal só aparece lá no ajuste E111, ou eu tenho que gerar o SPED para
// conferir o valor do ICMS a pagar ou credor"*.
//
// O print, linha a linha: 001 Por Saídas 1.204,16 · 002 Outros Débitos
// "Artigo 117, II do RICMS/00" 32,09 · 004 Total 1.236,25 · 005 Entradas 0,00
// · 006 Outros Créditos "Artigo 117, I do RICMS/00" 19,93 · 008 Subtotal
// 19,93 · 009 Saldo anterior 0,00 · 010 Total 19,93 · 011 Saldo Devedor
// 1.216,32 · 013 Imposto a Recolher 1.216,32 · 014 (vazio).
//
// A REGRA QUE ESTE TESTE TRAVA: relatório NUNCA tem conta própria. O E110 e o
// RAICMS leem `apurarIcmsProprio` — e o teste de COMPOSIÇÃO gera o bloco E
// de verdade e exige que cada campo do E110 seja a linha do papel.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { apurarIcmsProprio, montarRaicms, historicoDoAjuste } from '../sefaz-backend/apuracao-icms-raicms.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { classificarAjustes, aplicarAjustesApuracao } from '../sefaz-backend/sped-ajustes-apuracao.js';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const semComentario = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── Códigos FICTÍCIOS da 5.1.1 (a forma certa: UF + 3º '0' + 4º tipo) ──────
const COD_DEBITO_SP = 'SP000299';   // 4º '0' = outros débitos
const COD_CREDITO_SP = 'SP020799';  // 4º '2' = outros créditos

const linhaDe = (r: ReturnType<typeof montarRaicms>, cod: string) => r.linhas.find((l) => l.codigo === cod)!;

describe('📒 RAICMS — o modelo do e-Fiscal com os números da HYPE CAFÉ 08/2026', () => {
    const cls = classificarAjustes([
        { codigo: COD_DEBITO_SP, descricao: 'Artigo 117, II do RICMS/00', valor: 32.09 },
        { codigo: COD_CREDITO_SP, descricao: 'Artigo 117, I do RICMS/00', valor: 19.93 },
    ], 'SP');
    const ap = aplicarAjustesApuracao({ vlTotDebitos: 1204.16, vlTotCreditos: 0, vlSldCredorAnt: 0 }, cls);
    const r = montarRaicms({ ap, cls }, { origemSaldoAnterior: 'ficha desta competência' });

    it('tem as 14 linhas na ordem do papel', () => {
        expect(r.linhas.map((l) => l.codigo)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014']);
    });

    it('fecha centavo a centavo com o print: 1.204,16 + 32,09 − 19,93 = 1.216,32', () => {
        expect(linhaDe(r, '001').soma).toBe(1204.16);
        expect(linhaDe(r, '002').soma).toBe(32.09);
        expect(linhaDe(r, '003').soma).toBe(0);
        expect(linhaDe(r, '004').soma).toBe(1236.25);
        expect(linhaDe(r, '005').soma).toBe(0);
        expect(linhaDe(r, '006').soma).toBe(19.93);
        expect(linhaDe(r, '008').soma).toBe(19.93);
        expect(linhaDe(r, '009').soma).toBe(0);
        expect(linhaDe(r, '010').soma).toBe(19.93);
        expect(linhaDe(r, '011').soma).toBe(1216.32);
        expect(linhaDe(r, '013').soma).toBe(1216.32);
        expect(linhaDe(r, '014').soma).toBe(0);
        expect(r.devedor).toBe(true);
        expect(r.impostoARecolher).toBe(1216.32);
    });

    it('o DIFAL do art. 117 aparece na COLUNA AUXILIAR com o histórico lançado — "só aparece no E111" era a queixa', () => {
        expect(linhaDe(r, '002').itens).toEqual([{ historico: 'Artigo 117, II do RICMS/00', codigo: COD_DEBITO_SP, valor: 32.09 }]);
        expect(linhaDe(r, '006').itens).toEqual([{ historico: 'Artigo 117, I do RICMS/00', codigo: COD_CREDITO_SP, valor: 19.93 }]);
        // Linha sem lançamento sai SEM item — o e-Fiscal imprime vazio, não 0,00.
        expect(linhaDe(r, '003').itens).toEqual([]);
        expect(linhaDe(r, '012').itens).toEqual([]);
    });

    it('a origem do saldo anterior viaja carimbada e o histórico sem descrição cai no código', () => {
        expect(r.origemSaldoAnterior).toBe('ficha desta competência');
        expect(historicoDoAjuste({ codigo: 'sp000299', descricao: '   ' })).toBe('SP000299');
        expect(historicoDoAjuste({ codigo: 'SP000299', descricao: 'Artigo 117, II' })).toBe('Artigo 117, II');
    });
});

describe('📒 RAICMS — o lado CREDOR e os avisos', () => {
    it('mês credor: 011 e 013 zeram e a 014 leva o saldo a transportar', () => {
        const cls = classificarAjustes([], 'SP');
        const ap = aplicarAjustesApuracao({ vlTotDebitos: 100, vlTotCreditos: 250.5, vlSldCredorAnt: 10 }, cls);
        const r = montarRaicms({ ap, cls });
        expect(r.devedor).toBe(false);
        expect(linhaDe(r, '008').soma).toBe(250.5);
        expect(linhaDe(r, '010').soma).toBe(260.5);
        expect(linhaDe(r, '011').soma).toBe(0);
        expect(linhaDe(r, '013').soma).toBe(0);
        expect(linhaDe(r, '014').soma).toBe(160.5);
        expect(r.saldoCredorATransportar).toBe(160.5);
    });

    it('ajuste com código inválido NÃO entra e sai DITO; dedução que não abate sai dita; débito especial fica fora', () => {
        const cls = classificarAjustes([
            { codigo: 'XX', descricao: 'torto', valor: 5 },
            { codigo: 'SP040199', descricao: 'dedução maior que o saldo', valor: 500 },
            { codigo: 'SP050199', descricao: 'débito especial', valor: 7 },
        ], 'SP');
        const ap = aplicarAjustesApuracao({ vlTotDebitos: 100, vlTotCreditos: 0, vlSldCredorAnt: 0 }, cls);
        const r = montarRaicms({ ap, cls });
        expect(linhaDe(r, '012').soma).toBe(100);
        expect(linhaDe(r, '012').itens[0].valor).toBe(500);
        expect(linhaDe(r, '013').soma).toBe(0);
        expect(r.avisos.some((a) => /IGNORADO/.test(a) && /XX/.test(a))).toBe(true);
        expect(r.avisos.some((a) => /Dedução de 400\.00 NÃO abateu/.test(a))).toBe(true);
        expect(r.avisos.some((a) => /Débitos especiais .*7\.00/.test(a))).toBe(true);
        expect(r.debitosEspeciais).toBe(7);
    });

    it('sem nenhum E111 num mês com movimento, o papel DIZ onde se lança (senão a coluna auxiliar vazia parece captura falha)', () => {
        const cls = classificarAjustes([], 'SP');
        const r = montarRaicms({ ap: aplicarAjustesApuracao({ vlTotDebitos: 10 }, cls), cls });
        expect(r.avisos.some((a) => /Nenhum ajuste E111/.test(a) && /Ajustes E111/.test(a))).toBe(true);
    });

    it('fora do Lucro a apuração vem zerada — o Simples não apura ICMS próprio', () => {
        const { ap, cls } = apurarIcmsProprio({ empresa: { _regime: 'simples', dadosFiscais: { uf: 'SP' } }, notas: [], ajustesApuracao: [{ codigo: COD_DEBITO_SP, valor: 1 }] });
        expect(ap.vlTotDebitos).toBe(0);
        expect(cls.validos).toEqual([]);
    });
});

// ── COMPOSIÇÃO: o bloco E de verdade × o papel ─────────────────────────────
const EMPRESA = '14583444000101';
const FORNECEDOR = '44555666000177';
const CH_ENT = '35260844555666000177550010000012341000012345';
const CH_SAI = '35260814583444000101550010000000991000000999';
const entrada = () => ({
    id: CH_ENT, chave: CH_ENT, numero: '1234', serie: '1', direcao: 'entrada', status: 'autorizado',
    tpNF: '1', dhEmi: '2026-08-05T10:00:00-03:00',
    cnpjEmit: FORNECEDOR, xNomeEmit: 'FORNECEDOR TESTE LTDA', ufEmit: 'SP',
    cnpjDest: EMPRESA, xNomeDest: 'HYPE TESTE LTDA',
    valorTotal: 1000, totais: { vProd: 1000, vNF: 1000, vBC: 1000, vICMS: 180 },
    itens: [{ nItem: '1', cProd: 'P1', xProd: 'PRODUTO', NCM: '49019900', CFOP: '5102', uCom: 'UN', qCom: 10, vProd: 1000, CST: '000', vBC: 1000, pICMS: 18, vICMS: 180 }],
});
const saida = () => ({
    id: CH_SAI, chave: CH_SAI, numero: '99', serie: '1', direcao: 'saida', status: 'autorizado', tpNF: '1',
    dhEmi: '2026-08-10T10:00:00-03:00', cnpjEmit: EMPRESA, xNomeEmit: 'HYPE TESTE LTDA',
    cnpjDest: '12345678000199', xNomeDest: 'CLIENTE', totais: { vProd: 6689.78, vNF: 6689.78, vBC: 6689.78, vICMS: 1204.16 },
    itens: [{ nItem: '1', cProd: 'V1', xProd: 'PRODUTO', NCM: '49019900', CFOP: '5102', uCom: 'UN', qCom: 1, vProd: 6689.78, CST: '000', vBC: 6689.78, pICMS: 18, vICMS: 1204.16 }],
});
const dadosDe = (notas: any[], ajustes: any[] = [], saldoAnt = 0) => ({
    empresa: { cnpj: EMPRESA, _regime: 'lucro', regimePadrao: 'LUCRO_PRESUMIDO', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' } },
    competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
    notas, ajustesApuracao: ajustes, saldoCredorIcmsAnterior: saldoAnt, warnings: [] as string[],
});
const campos = (l: string) => l.trim().split('|');
const brl = (s: string) => parseFloat(s.replace(',', '.')) || 0;

describe('🚦 COMPOSIÇÃO — o E110 do arquivo É o papel, campo a campo', () => {
    const provar = (dados: any) => {
        buildBlocoC(dados);
        const e = (buildBlocoE(dados) as string[]).map((l) => l.trim());
        const e110 = campos(e.find((l) => l.startsWith('|E110|'))!);
        const r = montarRaicms(apurarIcmsProprio(dados));
        // E110: 02 débitos · 04 aj.débitos · 05 est.créd · 06 créditos · 08 aj.créd ·
        // 09 est.déb · 10 saldo ant · 11 saldo devedor · 12 deduções · 13 recolher · 14 transportar
        expect(brl(e110[2])).toBe(linhaDe(r, '001').soma);
        expect(brl(e110[4])).toBe(linhaDe(r, '002').soma);
        expect(brl(e110[5])).toBe(linhaDe(r, '003').soma);
        expect(brl(e110[6])).toBe(linhaDe(r, '005').soma);
        expect(brl(e110[8])).toBe(linhaDe(r, '006').soma);
        expect(brl(e110[9])).toBe(linhaDe(r, '007').soma);
        expect(brl(e110[10])).toBe(linhaDe(r, '009').soma);
        expect(brl(e110[11])).toBe(linhaDe(r, '011').soma);
        expect(brl(e110[12])).toBe(linhaDe(r, '012').soma);
        expect(brl(e110[13])).toBe(linhaDe(r, '013').soma);
        expect(brl(e110[14])).toBe(linhaDe(r, '014').soma);
        // As somas do papel que o E110 não carrega fecham com a conta do Guia.
        const s = (c: string) => linhaDe(r, c).soma;
        expect(s('004')).toBe(Math.round((s('001') + s('002') + s('003')) * 100) / 100);
        expect(s('008')).toBe(Math.round((s('005') + s('006') + s('007')) * 100) / 100);
        expect(s('010')).toBe(Math.round((s('008') + s('009')) * 100) / 100);
        if (r.devedor) expect(s('011')).toBe(Math.round((s('004') - s('010')) * 100) / 100);
        else expect(s('014')).toBe(Math.round((s('010') - s('004')) * 100) / 100);
        return { e110, r, e };
    };

    it('com o par do art. 117 lançado: débito 1.204,16 + 32,09 − 19,93 = 1.216,32 nos DOIS', () => {
        const { r, e } = provar(dadosDe([saida()], [
            { codigo: COD_DEBITO_SP, descricao: 'DIFAL aquisicao - RICMS/SP art. 117, II (1 nota(s))', valor: 32.09, origem: 'difal-art117' },
            { codigo: COD_CREDITO_SP, descricao: 'DIFAL aquisicao - RICMS/SP art. 117, I (1 nota(s))', valor: 19.93, origem: 'difal-art117' },
        ]));
        expect(linhaDe(r, '013').soma).toBe(1216.32);
        expect(e.filter((l) => l.startsWith('|E111|')).length).toBe(2);
        expect(linhaDe(r, '002').itens[0].historico).toMatch(/art\. 117, II/);
    });

    it('com entrada creditando e saldo anterior: credor nos DOIS', () => {
        const { r } = provar(dadosDe([entrada(), saida()], [], 2000));
        expect(r.devedor).toBe(false);
        expect(linhaDe(r, '005').soma).toBe(180);
        expect(linhaDe(r, '014').soma).toBe(975.84);
    });

    it('com estornos e dedução: as linhas 003/007/012 fecham nos DOIS', () => {
        const { r } = provar(dadosDe([entrada(), saida()], [
            { codigo: 'SP010199', descricao: 'estorno de crédito', valor: 30 },
            { codigo: 'SP030199', descricao: 'estorno de débito', valor: 12.5 },
            { codigo: 'SP040199', descricao: 'dedução', valor: 100 },
        ]));
        expect(linhaDe(r, '003').soma).toBe(30);
        expect(linhaDe(r, '007').soma).toBe(12.5);
        expect(linhaDe(r, '012').soma).toBe(100);
        expect(linhaDe(r, '013').soma).toBe(Math.round((1204.16 + 30 - 180 - 12.5 - 100) * 100) / 100);
    });

    it('sem nota e sem ajuste: tudo zero, e nada explode', () => {
        const { r } = provar(dadosDe([]));
        expect(r.impostoARecolher).toBe(0);
    });
});

// ── TRAVA NA FONTE: uma apuração, dois leitores ────────────────────────────
describe('🚦 trava na FONTE — a apuração do ICMS tem UM dono', () => {
    it('o bloco E lê `apurarIcmsProprio` e não fecha o saldo por conta própria', () => {
        const src = semComentario(ler('sefaz-backend/sped-fiscal-blocoE.js'));
        expect(src).toMatch(/const \{ ap, cls \} = apurarIcmsProprio\(dados\);/);
        expect(src).not.toMatch(/aplicarAjustesApuracao\(/);
        expect(src).not.toMatch(/classificarAjustes\(/);
    });

    it('a rota passa pelo MESMO coletor do /gerar e pelo dono — e não grava nada', () => {
        const src = ler('sefaz-backend/sped-fiscal-routes.js');
        const rota = src.slice(src.indexOf("router.get('/apuracao-icms'"), src.indexOf("router.get('/saldo-abertura'"));
        expect(rota).toMatch(/await coletarDadosEmpresa\(\{/);
        expect(rota).toMatch(/apurarIcmsProprio\(dados\)/);
        expect(rota).toMatch(/montarRaicms\(apuracao/);
        expect(rota).toMatch(/podeAcessarEmpresaId\(req\.user/);
        expect(rota).not.toMatch(/\.set\(|\.update\(|montarBlocos\(/);
    });

    it('a tela e o service NÃO calculam: nem soma, nem aplicarAjustesApuracao, nem somarIcms', () => {
        const tela = ler('components/Relatorios/index.tsx');
        const aba = tela.slice(tela.indexOf('const AbaApuracaoIcms'), tela.indexOf('export default RelatoriosHub'));
        expect(aba.length).toBeGreaterThan(500);
        expect(aba).not.toMatch(/aplicarAjustesApuracao|somarIcms|classificarAjustes|\.soma\s*[+\-]|reduce\(/);
        expect(aba).toMatch(/carregarApuracaoIcms\(empresaId, competencia\)/);
        expect(aba).toMatch(/montarIdentificacao\(dados\.identificacao\)/);
        const service = ler('services/apuracaoIcmsService.ts');
        expect(service).toMatch(/\/api\/admin\/sped-fiscal\/apuracao-icms\?empresaId=/);
    });

    it('quem chama `aplicarAjustesApuracao` é o dono da apuração ou a cronologia do saldo — mais ninguém', () => {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(RAIZ, 'sefaz-backend');
        const permitidos: Record<string, string> = {
            'sped-ajustes-apuracao.js': 'é a DEFINIÇÃO da fórmula do E110',
            'apuracao-icms-raicms.js': 'o dono da apuração — quem o E110 e o RAICMS leem',
            'saldo-abertura.js': 'a cronologia do saldo de abertura transporta mês a mês com a MESMA matemática (21/08)',
        };
        const chamadores = (fs.readdirSync(dir) as string[])
            .filter((f) => f.endsWith('.js'))
            .filter((f) => /aplicarAjustesApuracao\(/.test(semComentario(fs.readFileSync(path.join(dir, f), 'utf8'))))
            .filter((f) => !/^export function aplicarAjustesApuracao/m.test(fs.readFileSync(path.join(dir, f), 'utf8')) || f === 'sped-ajustes-apuracao.js');
        for (const f of chamadores) {
            expect(permitidos[f]).toBeDefined();
        }
        expect(chamadores).toEqual(expect.arrayContaining(['apuracao-icms-raicms.js']));
        expect(Object.keys(permitidos).every((k) => fs.existsSync(path.join(dir, k)))).toBe(true);
    });
});
