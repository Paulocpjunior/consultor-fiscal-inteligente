// ============================================================================
// 🚨 O ISS CHEGAVA EM QUATRO FORMAS E OS RELATÓRIOS LIAM UMA — a do NAVEGADOR,
// que é a minoria das notas
//
// A varredura de 22/08 (o eixo "quem lê campo de documento passa pelo DONO")
// chegou no ISS e achou a armadilha das duas formas na versão mais larga que
// ela já teve neste projeto: **só o import pelo NAVEGADOR**
// (`services/xmlParserService.ts`) grava o objeto `valores{}`. Os trilhos que
// trazem a esmagadora maioria das NFS-e gravam de outro jeito:
//
//   · portal de SP — CSV/TXT **e** o WS legado → `valorIss` · `issDevido`
//     (e `issRetido` BOOLEANO, sem valor separado);
//   · **ABRASF** → `totais.vISS` · `totais.vISSRetido`;
//   · **ADN** (NFS-e Nacional) → `valorIss`, e com `tipo: 'nfseNacional'`.
//
// 🔴 O QUE ISSO CUSTAVA, por leitor:
//
//   · **ICMS/IPI/ISS destacados** (relatório) — `d.valores?.iss || 0` ⇒ o ISS
//     da carteira inteira somava **0,00**. Zero num relatório de imposto
//     destacado é indistinguível de "não teve ISS";
//   · **Serviços tomados/prestados** e **Retenções** — as colunas de ISS
//     zeradas E, pior, o filtro `d.tipo === 'NFSe'` fazia a nota do **ADN**
//     sumir INTEIRA das três abas;
//   · **NFTS** (declaração de serviços TOMADOS de SP) — mesma sumida, e é
//     justamente ali que entra o prestador de fora do município;
//   · **DCTFWeb — a TRAVA do fechamento**: `contarRetencoesTomadas` lia só
//     `valores.*`, então em toda NFS-e do portal o total dava ZERO, o
//     `seloReinf` respondia `sem-movimento` e o veredito saía **'pronto'** —
//     *"os três insumos confirmados, pode fechar sem retrabalho"* — sobre uma
//     competência COM retenções. A trava dizia via livre exatamente no caso
//     que ela existe para barrar;
//   · **Recuperação tributária** — a tese do ISS recolhido no local errado
//     exige `issValor > 0` e respondia `sem_oportunidade` sem ter lido nada.
//
// ✂️ `issDoDocumento` / `issRetidoDoDocumento` / `issRetidoDeclarado` nascem no
// `xml-metadata-helper` — a casa das leituras de documento, onde o
// `valorDoDocumento` também foi parar em 21/08, e pela MESMA razão.
//
// ⚠️ E a sequência certa JÁ EXISTIA, copiada em DOIS lugares (`iss-carteira.js`
// desde 06/08 e `issSpApuracao.ts`). É assim que a régua começa a divergir:
// não por ninguém saber menos, mas por a resposta morar em três cabeças.
// ============================================================================
import { issDoDocumento, issRetidoDoDocumento, issRetidoDeclarado } from '../sefaz-backend/xml-metadata-helper.js';
import { contarRetencoesTomadas, seloReinf, vereditoInsumos, seloEsocial, seloMit } from '../sefaz-backend/dctfweb-insumos.js';
import { resumoImpostos, linhasServicos, linhasRetencoes } from '../services/relatoriosAgregacoes';
import type { DocumentoFiscal } from '../types';

// ─── As quatro formas, como cada trilho DE VERDADE grava ────────────────────

/** `services/xmlParserService.ts` — o único que monta `valores{}`. */
const doNavegador = (over: any = {}) => ({
    id: 'nav', tipo: 'NFSe', direcao: 'saida', status: 'autorizado', competencia: '2026-07',
    dhEmi: '2026-07-10T10:00:00-03:00', numero: '1', valorTotal: 1000,
    valores: { iss: 50, valorIssRetido: 20, baseCalculo: 1000 },
    ...over,
});

/** `sefaz-backend/nfse-sp-csv-importer.js` — ACHATADO, sem `valores{}`. */
const doPortalSP = (over: any = {}) => ({
    id: 'sp', tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
    competencia: '2026-07', dhEmi: '2026-07-11T10:00:00-03:00', numero: '2',
    valorTotal: 2000, valorServicos: 2000,
    valorIss: 100, issDevido: 100, issRetido: false,
    ...over,
});

/** `sefaz-backend/abrasf/importer.js` — tudo em `totais`. */
const doAbrasf = (over: any = {}) => ({
    id: 'abrasf', tipo: 'NFSe', direcao: 'saida', status: 'autorizado', competencia: '2026-07',
    dhEmi: '2026-07-12T10:00:00-03:00', numero: '3', valorTotal: 3000,
    totais: { vNF: 3000, vISS: 150, vISSRetido: 30 },
    ...over,
});

/** `sefaz-backend/nfse-nacional-dfe-importer.js` — e o RÓTULO é outro. */
const doADN = (over: any = {}) => ({
    id: 'adn', tipo: 'nfseNacional', tipoDoc: 'nfseNacional', direcao: 'saida',
    status: 'autorizado', competencia: '2026-07', dhEmi: '2026-07-13T10:00:00-03:00',
    numero: '4', valorTotal: 4000, valorIss: 200,
    ...over,
});

describe('🚨 o DONO lê as quatro formas', () => {
    it('o ISS devido sai igual venha de onde vier', () => {
        expect(issDoDocumento(doNavegador())).toBe(50);
        expect(issDoDocumento(doPortalSP())).toBe(100);
        expect(issDoDocumento(doAbrasf())).toBe(150);
        expect(issDoDocumento(doADN())).toBe(200);
    });

    it('e o retido também — quando o documento traz o VALOR', () => {
        expect(issRetidoDoDocumento(doNavegador())).toBe(20);
        expect(issRetidoDoDocumento(doAbrasf())).toBe(30);
    });

    // ⚠️ "Não teve ISS" e "não achei o ISS" são fatos diferentes — é o mesmo
    // contrato do `valorDoDocumento`, e foi o zero silencioso que produziu 37
    // A100 zerados num arquivo entregue à Receita.
    it('ausência devolve NaN, NUNCA zero', () => {
        expect(Number.isNaN(issDoDocumento({}))).toBe(true);
        expect(Number.isNaN(issDoDocumento(null))).toBe(true);
        expect(Number.isNaN(issRetidoDoDocumento(doPortalSP()))).toBe(true);
    });

    // ⚠️ O portal afirma a retenção com um BOOLEANO e não diz quanto. Somar 0
    // como se fosse o valor retido seria declarar retenção nenhuma sobre nota
    // que teve — por isso são duas perguntas separadas.
    it('o booleano do portal declara a retenção sem dizer o valor', () => {
        const retida = doPortalSP({ issRetido: true });
        expect(issRetidoDeclarado(retida)).toBe(true);
        expect(Number.isNaN(issRetidoDoDocumento(retida))).toBe(true);
        expect(issRetidoDeclarado(doPortalSP())).toBe(false);
    });

    // ⚠️ `issAPagar`/`issPago` respondem "quanto FALTA pagar", não "quanto o
    // documento destacou" — a nota já quitada apareceria com ISS zero.
    it('não confunde o destacado com o que falta pagar', () => {
        expect(Number.isNaN(issDoDocumento({ issAPagar: 90, issPago: 10 }))).toBe(true);
    });
});

describe('🚨 o relatório de ICMS/IPI/ISS destacados', () => {
    it('soma o ISS das QUATRO formas — antes só a do navegador entrava', () => {
        const r = resumoImpostos([doNavegador(), doPortalSP(), doAbrasf(), doADN()] as any);
        expect(r.iss.prestados).toBe(500);   // 50 + 100 + 150 + 200
    });

    it('e o ISS retido do serviço TOMADO entra do lado dele', () => {
        const r = resumoImpostos([doNavegador({ direcao: 'entrada' })] as any);
        expect(r.iss).toEqual({ prestados: 0, retidoTomados: 20 });
    });

    // 🔴 O caso que fazia a nota SUMIR: o rótulo do ADN não é 'NFSe', então ela
    // caía no ramo de mercadoria e o ISS dela não era somado em lugar nenhum.
    it('a NFS-e do ADN não escapa pelo ramo de mercadoria', () => {
        expect(resumoImpostos([doADN()] as any).iss.prestados).toBe(200);
    });

    // A régua não pode inverter o caso comum: NF-e continua no ramo do ICMS.
    it('a NF-e continua sendo lida como mercadoria', () => {
        const nfe = { id: 'n', tipo: 'NFe', direcao: 'saida', status: 'autorizado', totais: { vICMS: 18 } };
        const r = resumoImpostos([nfe] as any);
        expect({ icms: r.icms.debitoSaidas, iss: r.iss.prestados }).toEqual({ icms: 18, iss: 0 });
    });
});

describe('🚨 as abas de Serviços e Retenções', () => {
    it('a NFS-e do ADN aparece na lista — antes ela sumia inteira', () => {
        const linhas = linhasServicos([doADN(), doPortalSP()] as any, 'saida');
        expect(linhas.map(l => l.numero).sort()).toEqual(['2', '4']);
    });

    it('e a coluna de ISS deixa de sair 0,00 na nota do portal', () => {
        const [l] = linhasServicos([doPortalSP()] as any, 'saida');
        expect(l.iss).toBe(100);
    });

    it('o ISS retido do ABRASF chega à aba de Retenções', () => {
        const linhas = linhasRetencoes([doAbrasf({ direcao: 'entrada' })] as any, 'entrada');
        expect(linhas.map(l => l.issRetido)).toEqual([30]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 O CUSTO MAIS CARO: a TRAVA do fechamento da DCTFWeb dizia VIA LIVRE
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a trava dos insumos da DCTFWeb', () => {
    /** NFS-e TOMADA com IR/INSS/CSLL retidos, na forma do portal (achatada). */
    const tomadaComRetencaoDoPortal = doPortalSP({
        id: 't1', direcao: 'entrada',
        valorIr: 15, valorInss: 110, valorCsll: 20,
    });

    it('conta a retenção gravada na forma ACHATADA do portal', () => {
        const r = contarRetencoesTomadas([tomadaComRetencaoDoPortal], '2026-07');
        expect(r).toEqual({ totalNotasComRetencao: 1, semCamposGravados: 0 });
    });

    it('e a do ADN, que nem era reconhecida como nota de serviço', () => {
        const r = contarRetencoesTomadas(
            [doADN({ direcao: 'entrada', valorIr: 15 })], '2026-07',
        );
        expect(r.totalNotasComRetencao).toBe(1);
    });

    // 🚨 O DESFECHO — é este número que decide se a competência pode fechar.
    it('com retenção e sem lote, o veredito é INCOMPLETO (era "pronto")', () => {
        const retencoesApuradas = contarRetencoesTomadas([tomadaComRetencaoDoPortal], '2026-07');
        const selos = [
            seloEsocial({ ok: true, entregue: true, dataEntrega: '2026-08-01' }),
            seloReinf({ lotesGateway: [], retencoesApuradas }),
            seloMit({ ok: true, situacao: 3 }),
        ];
        expect(selos[1].estado).toBe('pendente');
        expect(vereditoInsumos(selos).veredito).toBe('incompleto');
    });

    // ⚠️ E o contrário continua valendo: nota tomada SEM retenção não vira
    // pendência. Alarme onde não há nada a fazer é o que ensina a ignorar o
    // alarme que importa.
    it('nota tomada sem retenção nenhuma segue sem-movimento', () => {
        const r = contarRetencoesTomadas([doPortalSP({ direcao: 'entrada', valorIr: 0, valorInss: 0, valorCsll: 0 })], '2026-07');
        expect(r.totalNotasComRetencao).toBe(0);
        expect(seloReinf({ lotesGateway: [], retencoesApuradas: r }).estado).toBe('sem-movimento');
    });

    // ⚠️ Nota SEM nenhum dos campos gravados não é nota sem retenção: é lacuna
    // de captura, e ela sai CONTADA — ausência ≠ zero.
    it('nota sem os campos gravados é contada à parte, não somada como zero', () => {
        const r = contarRetencoesTomadas([doPortalSP({ direcao: 'entrada' })], '2026-07');
        expect(r).toEqual({ totalNotasComRetencao: 0, semCamposGravados: 1 });
    });

    it('e a competência continua sendo respeitada', () => {
        const r = contarRetencoesTomadas([{ ...tomadaComRetencaoDoPortal, competencia: '2026-06' }], '2026-07');
        expect(r.totalNotasComRetencao).toBe(0);
    });
});
