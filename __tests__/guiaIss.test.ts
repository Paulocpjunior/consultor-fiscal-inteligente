/**
 * 🏛️ QUAL GUIA DE ISS O ENVIO É — trava de 30/09.
 *
 * Paulo (SILVIO FREIRE LANCHONETE e outras com ISS): *"dá ISS retido
 * prestador, porém já foi enviado por fora, já fiz rito também, mas essa
 * pendência não sai da tela"*. Dois defeitos:
 *  1. "ISS" digitado numa empresa que só deve o RETIDO fechava o PRÓPRIO
 *     (que ela nem devia), e o retido ficava âmbar para sempre;
 *  2. a baixa mandava o retido atrás da tarefa `ISS` (do prestador) e gravava
 *     `sem-tarefa` — pendência sem saída, porque o retido não tem tarefa.
 */
import { ehTipoIss, ehTipoIssRetido, guiaIssDoEnvio } from '../sefaz-backend/guia-iss.js';
import { pendenciaBaixa, conferirRitoDosEnvios } from '../sefaz-backend/envio-imposto-painel.js';
// @ts-expect-error — módulo .js puro
import { obrigacaoDoTipo } from '../sefaz-backend/envio-imposto.js';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';

const CHAVE_55 = '3526' + '07' + '1'.repeat(14) + '55' + '1'.repeat(22);
const doc = (over: any = {}) => ({
    chave: CHAVE_55, direcao: 'entrada', competencia: '2026-07',
    valorTotal: 100, temItens: true, schema: 'procNFe', status: 'autorizado', ...over,
});
const tarefa = (over: any = {}) => ({ obrigacao: 'DCTFWEB', competencia: '07/2026', status: 'concluida', ...over });
const envio = (over: any = {}) => ({
    tipo: 'DAS', competencia: '2026-07',
    sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' }, ...over,
});
/** O registro por fora como ele fica gravado ANTES da régua: `sem-tarefa` procurando o ISS próprio. */
const envioIssSemTarefa = (tipo: string) => envio({
    tipo, canal: 'fora-do-app', sharePoint: { status: 'sem-pdf' },
    baixa: { status: 'sem-tarefa', obrigacao: 'ISS', competencia: '07/2026' },
});
const iss = (over: any = {}) => ({
    aplicavel: true, situacao: 'so-tomado', notas: 0, aRecolher: 0,
    issForaDoTotal: 0, tomadoRetido: 5.86, tomadoNotas: 1, acao: null, ...over,
});
const rotina = (over: any = {}) => montarRotinaFiscal({
    empresa: { nome: 'SILVIO FREIRE LANCHONETE LTDA', cnpj: '17660729000197' },
    competencia: '2026-07',
    documentos: [doc(), doc({ direcao: 'saida', chave: CHAVE_55.replace(/1$/, '2') })],
    apuracao: { fonte: 'simples', totalImpostos: 1234.56 },
    tarefas: [tarefa()],
    ...over,
});
const guias = (r: any) => r.etapas.find((e: any) => e.id === 'guias');

describe('o texto do tipo', () => {
    it('nomeia ISS e ISS retido, com acento, hífen ou por extenso', () => {
        for (const t of ['ISS', 'issqn', 'GUIA ISS PMSP', 'ISS-RETIDO']) expect(ehTipoIss(t)).toBe(true);
        for (const t of ['ISS RETIDO', 'iss-retido', 'ISS RETENÇÃO', 'ISS TOMADOR']) expect(ehTipoIssRetido(t)).toBe(true);
        for (const t of ['DAS', 'DARF', 'DISSIDIO']) expect(ehTipoIss(t)).toBe(false);
        expect(ehTipoIssRetido('ISS')).toBe(false);
        expect(ehTipoIssRetido('RETIDO')).toBe(false);
    });
});

describe('qual guia o envio é', () => {
    it('"ISS" numa empresa que só deve o RETIDO é o retido — não há outra que ele possa ser', () => {
        expect(guiaIssDoEnvio({ tipo: 'ISS' }, { aRecolher: 0, tomado: 5.86 })).toBe('retido');
    });

    it('"ISS" com as DUAS devidas continua o próprio; o texto RETIDO decide o retido', () => {
        expect(guiaIssDoEnvio({ tipo: 'ISS' }, { aRecolher: 100, tomado: 800 })).toBe('proprio');
        expect(guiaIssDoEnvio({ tipo: 'ISS RETIDO' }, { aRecolher: 100, tomado: 800 })).toBe('retido');
    });

    it('sem saber o que a empresa deve, só o texto decide; envio que não é de ISS fica de fora', () => {
        expect(guiaIssDoEnvio({ tipo: 'ISS' })).toBe('proprio');
        expect(guiaIssDoEnvio({ tipo: 'ISS RETIDO' })).toBe('retido');
        expect(guiaIssDoEnvio({ tipo: 'DAS' }, { tomado: 10 })).toBeNull();
    });
});

describe('a baixa da guia do retido', () => {
    it('não procura a tarefa do ISS próprio — o retido não tem tarefa em Vencimentos', () => {
        expect(obrigacaoDoTipo('ISS RETIDO')).toBeNull();
        expect(obrigacaoDoTipo('ISS')).toBe('ISS');
    });

    it('registro antigo em `sem-tarefa` deixa de ser pendência quando é o retido — e só ele', () => {
        expect(pendenciaBaixa(envioIssSemTarefa('ISS RETIDO'))).toBeNull();
        expect(pendenciaBaixa({ ...envioIssSemTarefa('ISS'), guiaIss: 'retido' })).toBeNull();
        expect(pendenciaBaixa(envioIssSemTarefa('ISS'))).not.toBeNull();
        expect(conferirRitoDosEnvios([envioIssSemTarefa('ISS RETIDO')])[0].completo).toBe(true);
    });
});

describe('a Rotina do Mês (o print da SILVIO FREIRE)', () => {
    it('"ISS" registrado por fora numa empresa que só deve o retido FECHA a etapa 5', () => {
        const r = rotina({ iss: iss(), envios: [envio(), envioIssSemTarefa('ISS')] });
        expect(r.iss.retidoEnviado).toBe(true);
        expect(r.iss.pendencias).toEqual([]);
        expect(guias(r).status).toBe('concluida');
        expect(r.proximoPasso).toBeNull();
    });

    it('"ISS RETIDO" registrado por fora fecha a etapa 5, mesmo com o registro em `sem-tarefa`', () => {
        const r = rotina({ iss: iss(), envios: [envio(), envioIssSemTarefa('ISS RETIDO')] });
        expect(r.iss.pendencias).toEqual([]);
        expect(guias(r).status).toBe('concluida');
    });

    it('sem registro, o retido segue pendente e a ação diz COMO registrar', () => {
        const r = rotina({ iss: iss(), envios: [envio()] });
        expect(r.iss.retidoEnviado).toBe(false);
        expect(guias(r).status).toBe('atencao');
        expect(guias(r).acao).toMatch(/ISS RETIDO/);
    });

    it('com as duas devidas, "ISS" sozinho fecha só o próprio — o retido fica, dito', () => {
        const r = rotina({
            iss: iss({ aRecolher: 100, tomadoRetido: 800, tomadoNotas: 2 }),
            envios: [envio(), envio({ tipo: 'ISS' })],
        });
        expect(r.iss.proprioEnviado).toBe(true);
        expect(r.iss.retidoEnviado).toBe(false);
        expect(guias(r).acao).toMatch(/tipo ISS RETIDO/);
    });

    it('`sem-tarefa` de ISS em empresa que deve o PRÓPRIO continua pendência — o cron pode ter faltado', () => {
        const r = rotina({
            iss: iss({ aRecolher: 100, tomadoRetido: 0, tomadoNotas: 0 }),
            envios: [envio(), envioIssSemTarefa('ISS')],
        });
        expect(guias(r).status).toBe('atencao');
        expect(guias(r).acao).toMatch(/Gere as tarefas/);
    });
});
