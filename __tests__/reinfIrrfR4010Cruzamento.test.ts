/**
 * R-4010 × IRRF de PF da DCTFWeb.
 *
 * Paulo, 12/08/2026: o e-CAC lista os beneficiários um a um (CPF, recibo) e a
 * DCTFWeb cobra o IRRF; o CFI não cruzava nada disso. Evento que não chegou =
 * débito a menos = recolhimento a menor, e ninguém vê porque são dois sistemas.
 *
 * Os números do lado DCTFWeb são os do extrato REAL que ele mandou (COMUNIDADE
 * EVANGELICA, 07/2026): 0588-06 = 710,88 e 3208-06 = 18.859,51 são pagamento a
 * pessoa física; 0561-07 = 606,71 é trabalho ASSALARIADO, que vem do eSocial e
 * NÃO pode entrar nesta conta.
 */
// @ts-nocheck — módulos .js do backend
import { parseEventoReinf } from '../sefaz-backend/efd-reinf-parser.js';
import { separarIrrfDctfweb, classificarIrrfDctfweb } from '../sefaz-backend/irrf-dctfweb-familias.js';
import { consolidarR4010, cruzarIrrfR4010 } from '../sefaz-backend/reinf-irrf-r4010-cruzamento.js';

const NS = 'http://www.reinf.esocial.gov.br/schemas/evt4010PagtoBeneficiarioPF/v2_01_02';

/** Forma do gerador HOMOLOGADO do Consultor Contábil. */
const r4010 = (cpf: string, irrf: string, opts: any = {}) => `<?xml version="1.0"?>
<Reinf xmlns="${NS}"><evtRetPF id="ID${opts.id || '1'}">
 <ideEvento><indRetif>${opts.indRetif || 1}</indRetif><perApur>2026-07</perApur><tpAmb>1</tpAmb></ideEvento>
 <ideContri><tpInsc>1</tpInsc><nrInsc>03954491</nrInsc></ideContri>
 <ideEstab><tpInscEstab>1</tpInscEstab><nrInscEstab>03954491000106</nrInscEstab>
  <ideBenef><cpfBenef>${cpf}</cpfBenef>
   <idePgto><natRend>13002</natRend>
    <infoPgto><dtFG>2026-07-05</dtFG><vlrRendBruto>10000,00</vlrRendBruto><vlrRendTrib>10000,00</vlrRendTrib>${
        opts.semIr ? '' : `<vlrIR>${irrf}</vlrIR>`}</infoPgto>
   </idePgto>
  </ideBenef>
 </ideEstab>
</evtRetPF></Reinf>`;

// Extrato real do e-CAC.
const DEBITOS = [
    { codigo: '0561', codReceita: '056107', descricao: 'IRRF - RD TRB ASSAL PAIS/AUS NO EXT A SERV PAIS', valor: 606.71 },
    { codigo: '0588', codReceita: '058806', descricao: 'IRRF - REND DO TABALHO SEM VINCULO EMPREGATICIO', valor: 710.88 },
    { codigo: '3208', codReceita: '320806', descricao: 'IRRF - ALUG E ROYALTIES PAGOS A PF', valor: 18859.51 },
    { codigo: '1162', codReceita: '116201', descricao: 'CONTRIBUICAO PREVIDENCIARIA PATRONAL', valor: 5382.64 },
];

describe('de-para do IRRF na DCTFWeb', () => {
    it('separa PF (R-4010) de folha (eSocial) e de PJ (R-4020)', () => {
        const s = separarIrrfDctfweb(DEBITOS);
        expect(s.totais.pf).toBe(19570.39);        // 710,88 + 18.859,51
        expect(s.totais.folha).toBe(606.71);       // trabalho assalariado — eSocial
        expect(s.pf.map((d: any) => d.codigo).sort()).toEqual(['0588', '3208']);
    });

    it('o que não é IRRF sai de lado, sem virar problema', () => {
        const s = separarIrrfDctfweb(DEBITOS);
        expect(s.outros.map((d: any) => d.codigo)).toEqual(['1162']);
    });

    it('salário é pago a PF mas NÃO é R-4010 — a régua olha "ASSAL" primeiro', () => {
        const c = classificarIrrfDctfweb({ codigo: '9999', descricao: 'IRRF - REND TRB ASSAL PAGOS A PF' });
        expect(c.familia).toBe('irrf-folha-esocial');
    });

    it('código fora do de-para fica NÃO CLASSIFICADO — nunca chutado pra um lado', () => {
        const c = classificarIrrfDctfweb({ codigo: '4321', descricao: 'IRRF - ALGUMA COISA' });
        expect(c.familia).toBe('nao-classificado');
        expect(c.motivo).toMatch(/FORA dos dois totais/);
    });

    it('código e descrição em conflito ACENDEM em vez de escolher sozinhos', () => {
        const c = classificarIrrfDctfweb({ codigo: '1708', descricao: 'IRRF - ALUG E ROYALTIES PAGOS A PF' });
        expect(c.familia).toBe('nao-classificado');
        expect(c.motivo).toMatch(/mapeado como.*mas a descrição/i);
    });
});

describe('consolidação dos R-4010', () => {
    it('soma o vlrIR por beneficiário', () => {
        const eventos = [r4010('23036284826', '710,88'), r4010('28886735847', '18859,51')].map(parseEventoReinf);
        const c = consolidarR4010(eventos);
        expect(c.eventosLidos).toBe(2);
        expect(c.totalIrrf).toBe(19570.39);
        expect(c.beneficiarios[0].beneficiario).toBe('28886735847');
    });

    it('RETIFICADOR substitui o original — somar os dois dobraria a retenção', () => {
        const eventos = [
            r4010('23036284826', '1000,00', { id: '1' }),
            r4010('23036284826', '710,88', { id: '2', indRetif: 2 }),
        ].map(parseEventoReinf);
        const c = consolidarR4010(eventos);
        expect(c.totalIrrf).toBe(710.88);
        expect(c.retificados).toEqual(['23036284826']);
    });

    it('pagamento sem <vlrIR> é rendimento SEM retenção, não IRRF zero', () => {
        const ev = parseEventoReinf(r4010('23036284826', '', { semIr: true }));
        expect(ev.retencoes[0].temRetencao).toBe(false);
        expect(ev.observacoes.join(' ')).toMatch(/sem retencao, nao IRRF zero/i);
    });

    it('arquivo que não é R-4010 não some — vem contado', () => {
        const c = consolidarR4010([{ ok: true, codigo: 'R-2010', retencoes: [], ideEvento: {} }]);
        expect(c.totalIrrf).toBe(0);
        expect(c.ignorados[0].motivo).toMatch(/não é R-4010/);
    });
});

describe('cruzamento', () => {
    const dctfweb = separarIrrfDctfweb(DEBITOS);

    it('bate à centavo com o extrato real — e ainda assim não dá verde sem completude', () => {
        const reinf = consolidarR4010([r4010('1', '710,88'), r4010('2', '18859,51')].map(parseEventoReinf));
        const r = cruzarIrrfR4010({ reinf, dctfweb });
        expect(r.veredito).toBe('confere');
        expect(r.diferenca).toBe(0);
        expect(r.severidade).toBe('atencao');            // conjunto não declarado completo
        expect(r.mensagem).toMatch(/NO QUE FOI LIDO/);
    });

    it('conjunto completo + valores batendo = verde', () => {
        const reinf = consolidarR4010([r4010('1', '710,88'), r4010('2', '18859,51')].map(parseEventoReinf));
        const r = cruzarIrrfR4010({ reinf, dctfweb, conjuntoCompleto: true });
        expect(r.severidade).toBe('ok');
    });

    it('Reinf a MAIS é risco alto — retenção declarada sem débito', () => {
        const reinf = consolidarR4010([r4010('1', '25000,00')].map(parseEventoReinf));
        const r = cruzarIrrfR4010({ reinf, dctfweb });
        expect(r.veredito).toBe('reinf-maior');
        expect(r.severidade).toBe('alta');
        expect(r.acao).toMatch(/R-4099/);
    });

    it('DCTFWeb a mais sem completude NÃO acusa — o provável é faltar arquivo', () => {
        const reinf = consolidarR4010([r4010('1', '100,00')].map(parseEventoReinf));
        const parcial = cruzarIrrfR4010({ reinf, dctfweb });
        expect(parcial.veredito).toBe('dctfweb-maior');
        expect(parcial.severidade).toBe('atencao');
        const completo = cruzarIrrfR4010({ reinf, dctfweb, conjuntoCompleto: true });
        expect(completo.severidade).toBe('alta');
    });

    it('declaração ilegível não vira divergência', () => {
        const reinf = consolidarR4010([r4010('1', '710,88')].map(parseEventoReinf));
        const r = cruzarIrrfR4010({ reinf, dctfweb, dctfwebLido: false });
        expect(r.veredito).toBe('sem-dctfweb-legivel');
        expect(r.totalDctfweb).toBeNull();
        expect(r.diferenca).toBeNull();
    });

    it('zero dos dois lados SEM evento lido não é empate, é ausência', () => {
        const r = cruzarIrrfR4010({
            reinf: consolidarR4010([]),
            dctfweb: separarIrrfDctfweb([]),
        });
        expect(r.veredito).toBe('nada-dos-dois-lados');
        expect(r.severidade).toBe('atencao');
        expect(r.mensagem).toMatch(/ausência dos dois lados/);
    });

    it('folha e PJ ficam de fora, e a ressalva DIZ isso', () => {
        const reinf = consolidarR4010([r4010('1', '19570,39')].map(parseEventoReinf));
        const r = cruzarIrrfR4010({ reinf, dctfweb });
        expect(r.ressalvas.join(' ')).toMatch(/folha.*eSocial/i);
        expect(r.ressalvas.join(' ')).toMatch(/Cobertura PARCIAL/);
    });
});
