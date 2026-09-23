// ============================================================================
// 🚨 O BLOQUEIO DO FIM DE MÊS TINHA DUAS MONTAGENS — e a da TELA esquecia
// campos, em silêncio.
//
// 28/08, VINCENZO GUERRA BANANAS 63027940000194 (Paulo, com dois prints lado a
// lado): a Rotina mostrava *"5. Emitir e enviar guias — 3 envio(s), 1
// completo(s) pelo rito"* travando o mês, com o botão *"📋 Já enviei esta guia
// por fora"* embaixo — e, na tela ao lado, o DAS da MESMA competência **Pago**
// e **✉ Enviada 12/08/2026**.
//
//   *"foi enviado pelo sistema e até pago já… Mesmo fazendo esse registro ai
//    ele não assume pra encerrar o mês"*
//
// A causa não era a régua: `podeDeclararEnvio` nasceu em 27/08 e respondia
// `false` certinho. Era a PROJEÇÃO: `bloqueiosDasEtapas`, na Rotina, montava o
// bloqueio À MÃO com sete campos e **não copiava o campo**. Na tela,
// `undefined !== false` ⇒ a porta aparecia. Ele registrou o envio, e o mês
// continuou travado — porque declarar outro envio não cria pasta de SharePoint
// nem gera a obrigação que falta em Vencimentos.
//
// ⚠️ E a MESMA lacuna, na direção contrária, apagava a porta NOVA: a etapa 4
// manda `podeDeclararCobertura: true` e a tela pergunta `=== true`, então a
// saída da MANTOAN ficava INVISÍVEL justamente na tela onde a trava aparece.
//
// 📌 É a lição de 27/08 (`rotina-empresa-insumo.js`) na outra ponta: lá era o
// INSUMO montado à mão, aqui é a SAÍDA. Objeto montado à mão para atravessar
// uma fronteira é uma segunda cópia com outra roupa — e ela não quebra nada:
// as duas telas só passam a contar histórias diferentes sobre a mesma empresa.
// ============================================================================
import { bloqueioDaEtapa, podeDarFimDeMes } from '../sefaz-backend/fim-de-mes.js';
import { bloqueiosDasEtapas } from '../components/RotinaFiscalPainel';

/** A etapa 5 da VINCENZO, como a Rotina a monta: o app ENVIOU. */
const ETAPA_GUIAS_VINCENZO = {
    id: 'guias', ordem: 5, nome: 'Emitir e enviar guias',
    onde: 'Vencimentos e Obrigações → Envios (rito)',
    status: 'atencao',
    resumo: '3 envio(s), 1 completo(s) pelo rito.',
    acao: 'Preencha grupo + pasta em Central de XMLs → Integrações → SharePoint.',
    envios: 3, completos: 1,
    causas: ['Empresa sem pasta do SharePoint', 'Sem obrigação correspondente na aba Vencimentos'],
    // 🔴 O campo que a projeção da tela apagava.
    podeDeclararEnvio: false,
};

/** A etapa 4 da MANTOAN: o catálogo não cobre o INSS patronal. */
const ETAPA_OBRIGACOES_MANTOAN = {
    id: 'obrigacoes', ordem: 4, nome: 'Entregar obrigações',
    onde: 'Vencimentos e Obrigações', status: 'atencao',
    resumo: '7 obrigação(ões) entregue(s). · o catálogo NÃO cobre 1 obrigação(ões)',
    acao: 'Estas NÃO viram tarefa automática.',
    coberturaIncompleta: true,
    podeDeclararCobertura: true,
    propostas: ['INSS Patronal (depende de folha)'],
};

describe('🚨 a projeção da tela é a MESMA do backend', () => {
    it('a Rotina carrega `podeDeclararEnvio` — era ele que sumia na VINCENZO', () => {
        const [b] = bloqueiosDasEtapas([ETAPA_GUIAS_VINCENZO] as any);
        expect(b.podeDeclararEnvio).toBe(false);
    });

    it('e carrega a porta da cobertura + as obrigações nomeadas (MANTOAN)', () => {
        const [b] = bloqueiosDasEtapas([ETAPA_OBRIGACOES_MANTOAN] as any);
        expect(b.podeDeclararCobertura).toBe(true);
        expect(b.propostas).toEqual(['INSS Patronal (depende de folha)']);
    });

    // 🔒 A prova que fecha a classe: os DOIS caminhos (o painel e a recusa do
    // ato) têm de devolver o MESMO objeto. Enquanto forem duas montagens, um
    // campo novo entra num e não no outro — foi exatamente o que aconteceu.
    it('painel e recusa do ato devolvem bloqueios IDÊNTICOS', () => {
        const etapas = [ETAPA_GUIAS_VINCENZO, ETAPA_OBRIGACOES_MANTOAN];
        const daTela = bloqueiosDasEtapas(etapas as any);
        const doAto = podeDarFimDeMes({ etapas }).bloqueios;
        expect(daTela).toEqual(doAto);
    });

    it('etapa fechada não vira bloqueio em nenhum dos dois', () => {
        const fechada = { ...ETAPA_GUIAS_VINCENZO, status: 'concluida' };
        expect(bloqueiosDasEtapas([fechada] as any)).toEqual([]);
        expect(podeDarFimDeMes({ etapas: [fechada] }).bloqueios).toEqual([]);
    });

    // 'na' (não se aplica) também fecha — e nas duas pontas.
    it("status 'na' fecha nos dois", () => {
        const na = { ...ETAPA_GUIAS_VINCENZO, status: 'na' };
        expect(bloqueiosDasEtapas([na] as any)).toEqual([]);
        expect(podeDarFimDeMes({ etapas: [na] }).bloqueios).toEqual([]);
    });
});

describe('as CAUSAS do rito viajam — a tela precisa saber para onde mandar', () => {
    it('o bloqueio carrega as causas nomeadas pelo dono', () => {
        const [b] = bloqueiosDasEtapas([ETAPA_GUIAS_VINCENZO] as any);
        expect(b.causas).toEqual([
            'Empresa sem pasta do SharePoint',
            'Sem obrigação correspondente na aba Vencimentos',
        ]);
    });

    // Ausência é `null`, nunca `[]`: lista vazia leria como "conferi e não há
    // causa", que é afirmação diferente de "esta etapa não tem causas".
    it('etapa sem causas devolve null, não lista vazia', () => {
        const [b] = bloqueiosDasEtapas([{ ...ETAPA_GUIAS_VINCENZO, causas: undefined }] as any);
        expect(b.causas).toBeNull();
    });

    // Campo ausente vira `null`, nunca `false`: "a etapa não respondeu" e "a
    // etapa disse que não" são fatos diferentes, e a tela trata os dois
    // diferente (`!== false` numa porta, `=== true` na outra).
    it('booleano ausente vira null, nunca false', () => {
        const b = bloqueioDaEtapa({ id: 'captura', ordem: 1, nome: 'x', status: 'pendente' });
        expect(b.podeDeclararEnvio).toBeNull();
        expect(b.podeDeclararCobertura).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A SEGUNDA MONTAGEM NÃO VOLTA — por VARREDURA, não por lista: o defeito
// nasceu de alguém (eu) montar o objeto à mão numa fronteira, e vai renascer
// da mesma forma.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 a tela não monta bloqueio à mão', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src: string = fs.readFileSync(
        path.resolve(__dirname, '..', 'components/RotinaFiscalPainel.tsx'), 'utf8',
    );

    it('`bloqueiosDasEtapas` delega ao dono', () => {
        expect(src).toMatch(/\.map\(bloqueioDaEtapa\)/);
        expect(src).toMatch(/import \{ bloqueioDaEtapa \} from '\.\.\/sefaz-backend\/fim-de-mes\.js'/);
    });

    it('e não reescreve os campos do bloqueio à mão', () => {
        // A assinatura é a do objeto literal que existia: `id: e.id, ordem:`.
        expect(src).not.toMatch(/id:\s*e\.id,\s*ordem:\s*e\.ordem/);
    });
});
