/**
 * 🚫 02/10 — Paulo, no CONDOMINIO DO EDIFICIO BENJAMIN CONSTANT: "devemos
 * parametrizar nos casos em que empresas não possuem notas de saída mod.
 * 55/65 nem NFS, apenas entradas e serviços tomados, e fica impedindo o
 * fechamento do mês".
 *
 * Fatos cobrados: a marca da EMPRESA fecha a etapa 1 com entradas e zero
 * saída; sem marca, a etapa oferece a porta; saída chegando com marca é
 * ALERTA; o "zero NFS-e emitida" da marcada não é captura incerta, mas o
 * "sem CCM" continua; e a marca chega à régua (projeção da rota).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';
import { bloqueioDaEtapa } from '../sefaz-backend/fim-de-mes.js';
// @ts-expect-error — módulo .js puro
import { conferirMarcaSemSaida, marcaSemEmissaoDeSaida } from '../sefaz-backend/sem-emissao-saida.js';

const CHAVE_55 = '3526' + '07' + '1'.repeat(14) + '55' + '1'.repeat(22);
const entrada = (n: number) => ({
    chave: CHAVE_55.replace(/1$/, String(n)), direcao: 'entrada', competencia: '2026-09',
    valorTotal: 100, temItens: true, schema: 'procNFe', status: 'autorizado',
});
const saida = () => ({ ...entrada(9), direcao: 'saida' });
const MARCA = { saidaPropria: 'nao-emite', saidaPropriaMarca: { por: 'eunice@sp', em: '2026-10-02T12:00:00Z', motivo: 'condomínio' } };

const rotina = (over: any = {}) => montarRotinaFiscal({
    empresa: { nome: 'CONDOMINIO BENJAMIN CONSTANT', cnpj: '54061189000151', rotinaParametros: null },
    competencia: '2026-09',
    documentos: [entrada(1)],
    ...over,
});
const captura = (r: any) => r.etapas.find((e: any) => e.id === 'captura');

describe('etapa 1 de quem não emite saída', () => {
    it('sem a marca: âmbar "nenhuma nota de SAÍDA" e a porta para marcar', () => {
        const c = captura(rotina());
        expect(c.status).toBe('atencao');
        expect(c.podeMarcarSemSaida).toBe(true);
        expect(bloqueioDaEtapa(c).podeMarcarSemSaida).toBe(true);
    });

    it('com a marca: fecha com as entradas e diz por quê (quem marcou e o motivo)', () => {
        const c = captura(rotina({ empresa: { nome: 'X', cnpj: '54061189000151', rotinaParametros: MARCA } }));
        expect(c.status).toBe('concluida');
        expect(c.resumo).toMatch(/SEM emissão de saída/);
        expect(c.resumo).toMatch(/eunice@sp/);
        expect(c.podeMarcarSemSaida).toBe(false);
    });

    it('com a marca e chegando SAÍDA: alerta, e a nota não some', () => {
        const c = captura(rotina({
            empresa: { nome: 'X', cnpj: '54061189000151', rotinaParametros: MARCA },
            documentos: [entrada(1), saida()],
        }));
        expect(c.status).toBe('atencao');
        expect(c.resumo).toMatch(/chegaram 1 nota\(s\) de SAÍDA/);
    });

    it('sem documento nenhum, a marca não inventa captura', () => {
        const c = captura(rotina({ empresa: { nome: 'X', cnpj: '54061189000151', rotinaParametros: MARCA }, documentos: [] }));
        expect(c.status).not.toBe('concluida');
    });

    it('o zero NFS-e emitida da marcada não é "captura incerta"; o "sem CCM" continua', () => {
        const emp = { nome: 'X', cnpj: '54061189000151', rotinaParametros: MARCA };
        const incerta = captura(rotina({ empresa: emp, iss: { aplicavel: true, situacao: 'captura-incerta', notas: 0, aRecolher: 0 } }));
        expect(incerta.status).toBe('concluida');
        const semCcm = captura(rotina({ empresa: emp, iss: { aplicavel: true, situacao: 'sem-ccm', notas: 0, aRecolher: 0 } }));
        expect(semCcm.status).not.toBe('concluida');
    });
});

describe('a marca', () => {
    it('exige motivo e grava autor e data; desfazer volta para "esperada"', () => {
        expect(conferirMarcaSemSaida({ naoEmite: true, motivo: 'x', quem: 'a', agoraIso: 't' }).ok).toBe(false);
        const ok = conferirMarcaSemSaida({ naoEmite: true, motivo: 'condomínio', quem: 'a@b', agoraIso: '2026-10-02T12:00:00Z' });
        expect(ok).toMatchObject({ ok: true, valor: { saidaPropria: 'nao-emite', saidaPropriaMarca: { por: 'a@b', motivo: 'condomínio' } } });
        const desfaz = conferirMarcaSemSaida({ naoEmite: false, quem: 'a@b', agoraIso: 't' });
        expect(desfaz).toMatchObject({ ok: true, valor: { saidaPropria: 'esperada' } });
        expect(marcaSemEmissaoDeSaida({ saidaPropria: 'esperada' })).toBeNull();
    });

    it('a marca chega à régua: a rota passa rotinaParametros para a Rotina', () => {
        const src = readFileSync(join(__dirname, '..', 'sefaz-backend', 'rotina-fiscal-routes.js'), 'utf8');
        const chamada = src.slice(src.indexOf('montarRotinaFiscal({'), src.indexOf('montarRotinaFiscal({') + 1500);
        expect(chamada).toMatch(/rotinaParametros/);
    });
});
