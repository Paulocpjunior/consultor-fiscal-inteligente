// ============================================================================
// 🚨 O TRILHO DO ADN GRAVAVA UMA NOTA QUE NENHUM LEITOR DO APP ENXERGA
//
// A captura da NFS-e Nacional escreve em `documentos_fiscais` — a MESMA coleção
// de tudo — e gravava só o que o parser dela extraiu: `tipo: 'nfseNacional'`,
// `prestadorCnpj`, `tomadorCnpj`, `valorServico`, `valorIss`. **Sem `direcao`,
// sem `competencia`, sem `status`, sem `valorTotal` e sem os blocos de
// participante.**
//
// 🔴 A nota EXISTIA e não aparecia em lugar nenhum:
//
//   · sem `direcao` — fora do filtro Entradas/Saídas, do Livro, do Resumo por
//     CFOP, da aba de Serviços e do bloco A do EFD-Contribuições;
//   · sem `competencia` — fora de TODA consulta por competência, que é como o
//     app recorta o mês;
//   · `tipo: 'nfseNacional'` — o `detectTipo` da lista não conhece o rótulo e
//     cai no default `'NFe'`: a NFS-e aparecia como nota de MERCADORIA, com
//     valor 0,00 (ela não tem `totais.vNF`);
//   · sem `status` — a régua de cancelamento não tinha o que ler.
//
// ⚠️ E nada aqui é invenção: a direção vem de comparar prestador/tomador com o
// CNPJ da empresa (o que o importador do portal de SP já faz), a competência
// sai da data de emissão, e **o que não dá para derivar fica de fora,
// NOMEADO** — a régua de 06/08, campo fiscal não recebe default.
// ============================================================================
import {
    documentoDaNfseNacional, direcaoDaNfseNacional, competenciaDaEmissao,
    lacunasDaNfseNacional, eventoDaNfseNacional, eventoJaRegistrado,
    // @ts-expect-error — módulo backend .js sem .d.ts
} from '../sefaz-backend/nfse-nacional-gravacao.js';
import { issDoDocumento } from '../sefaz-backend/xml-metadata-helper.js';
import { ehNotaDeServico } from '../sefaz-backend/sped-selecao-documentos.js';
import { getView } from '../services/xmlDocumentoView';

const EMPRESA = '31947349000169';
const TERCEIRO = '99999999000199';

/** O que `extrairMetadadosNfse` devolve hoje, campo a campo. */
const meta = (over: any = {}) => ({
    tipoDoc: 'nfseNacional',
    chave: 'NFS3550308000000000000000000000000000000000000000001',
    numero: '4321',
    dataEmissao: '2026-07-15T09:30:00-03:00',
    codMunicipio: '3550308',
    prestadorCnpj: EMPRESA,
    prestadorIM: '12345678',
    tomadorCnpj: TERCEIRO,
    tomadorCpf: undefined,
    valorServico: 4000,
    valorIss: 200,
    aliquotaIss: 5,
    ...over,
});

describe('🚨 a NFS-e do ADN entra com o que os leitores precisam', () => {
    const d = { ...meta(), ...documentoDaNfseNacional(meta(), EMPRESA) };

    it('o rótulo é o que o app inteiro pergunta, e o trilho fica no tipoDoc', () => {
        expect(d.tipo).toBe('NFSe');
        expect(d.tipoDoc).toBe('nfseNacional');
    });

    it('a direção sai da comparação com o CNPJ da empresa', () => {
        expect(d.direcao).toBe('saida');
        expect(direcaoDaNfseNacional(meta({ prestadorCnpj: TERCEIRO, tomadorCnpj: EMPRESA }), EMPRESA))
            .toBe('entrada');
    });

    it('a competência sai da data de emissão', () => {
        expect(d.competencia).toBe('2026-07');
    });

    it('o valor entra nas formas que o dono lê', () => {
        expect(d.valorTotal).toBe(4000);
        expect(d.valorServicos).toBe(4000);
    });

    it('e os participantes nas formas que os donos lêem', () => {
        expect(d.cnpjEmit).toBe(EMPRESA);
        expect(d.cnpjDest).toBe(TERCEIRO);
        expect(d.prestador.cnpjCpf).toBe(EMPRESA);
    });

    // ── As provas que importam: os LEITORES passam a enxergar ──────────────
    it('a régua de "é serviço?" reconhece — antes ela ia para o bloco C', () => {
        expect(ehNotaDeServico(d)).toBe(true);
    });

    it('o ISS é lido pelo dono', () => {
        expect(issDoDocumento(d)).toBe(200);
    });

    it('e a lista para de mostrá-la como nota de MERCADORIA', () => {
        expect(getView(d as any).direcao).toBe('saida');
        expect(getView(d as any).valores.total).toBe(4000);
    });
});

describe('🚨 o que não dá para derivar fica de FORA, nomeado', () => {
    // ⚠️ Chutar um lado aqui colocaria a nota no livro errado — exatamente o
    // erro que a régua da direção existe para impedir.
    it('empresa que não é prestador nem tomador NÃO ganha direção', () => {
        const m = meta({ prestadorCnpj: TERCEIRO, tomadorCnpj: '11111111000111' });
        expect(direcaoDaNfseNacional(m, EMPRESA)).toBeNull();
        expect(documentoDaNfseNacional(m, EMPRESA)).not.toHaveProperty('direcao');
        expect(lacunasDaNfseNacional(m, EMPRESA)[0]).toMatch(/direção/);
    });

    // Nota na competência ERRADA some do mês certo e aparece no errado — pior
    // que nota sem competência.
    it('data ilegível NÃO vira competência', () => {
        expect(competenciaDaEmissao('sem data')).toBeNull();
        expect(competenciaDaEmissao('2026-13-01')).toBeNull();
        expect(competenciaDaEmissao('')).toBeNull();
        const m = meta({ dataEmissao: 'x' });
        expect(documentoDaNfseNacional(m, EMPRESA)).not.toHaveProperty('competencia');
        expect(lacunasDaNfseNacional(m, EMPRESA).join(' ')).toMatch(/competência/);
    });

    it('valor ilegível não vira zero', () => {
        const m = meta({ valorServico: undefined });
        const doc = documentoDaNfseNacional(m, EMPRESA);
        expect(doc).not.toHaveProperty('valorTotal');
        expect(lacunasDaNfseNacional(m, EMPRESA).join(' ')).toMatch(/valor do serviço/);
    });

    it('documento completo não gera lacuna nenhuma', () => {
        expect(lacunasDaNfseNacional(meta(), EMPRESA)).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E O EVENTO ESTAVA APAGANDO A NOTA
//
// O `docId` é a CHAVE nos dois casos, e a chave do evento é a **da NFS-e a que
// ele se refere**. Com `merge: true` e `tipo: meta.tipoDoc`, o evento
// reescrevia o `tipo` do documento para `'eventoNfseNacional'` — a nota
// deixava de ser nota.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o evento entra em eventos[], sem tocar na identidade', () => {
    const evt = { tipoDoc: 'eventoNfseNacional', tpEvento: 'C101', seq: '1', dh: '2026-07-20T10:00:00-03:00', justificativa: 'erro de emissão' };

    it('o evento vira um item do array, fiel ao que veio', () => {
        expect(eventoDaNfseNacional(evt)).toEqual({
            tpEvento: 'C101', seq: '1', dh: '2026-07-20T10:00:00-03:00',
            justificativa: 'erro de emissão', origem: 'adn',
        });
    });

    it('e não duplica quando a mesma sequência volta na rodada seguinte', () => {
        const e = eventoDaNfseNacional(evt);
        expect(eventoJaRegistrado([e], e)).toBe(true);
        expect(eventoJaRegistrado([e], eventoDaNfseNacional({ ...evt, seq: '2' }))).toBe(false);
        expect(eventoJaRegistrado([], e)).toBe(false);
    });

    it('evento sem nada legível não vira item vazio no array', () => {
        expect(eventoDaNfseNacional({})).toBeNull();
        expect(eventoJaRegistrado([], null)).toBe(true);   // nada a registrar
    });

    // 🚩 PENDÊNCIA NOMEADA: isto NÃO faz o cancelamento pelo ADN ser
    // detectado. `docCancelado` reconhece o **110111** da NF-e, e o código de
    // cancelamento do leiaute nacional da NFS-e não está provado neste repo —
    // carimbá-lo de memória seria inventar código de tabela oficial.
    it('o evento fica GRAVADO e FIEL — o tpEvento não é traduzido', () => {
        expect(eventoDaNfseNacional(evt).tpEvento).toBe('C101');
        expect(eventoDaNfseNacional({ ...evt, tpEvento: '110111' }).tpEvento).toBe('110111');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E O ACERVO JÁ CAPTURADO CONTINUA COM O RÓTULO ANTIGO
//
// A gravação foi corrigida, mas ela só vale da próxima rodada em diante. As
// notas do ADN que já estão na base seguem com `tipo: 'nfseNacional'` — e é a
// régua da LEITURA que tem de responder por elas. `detectTipo` (a régua da
// lista) perguntava `tipo === 'NFSe'`, não casava, e caía no default `'NFe'`:
// a NFS-e aparecia como nota de MERCADORIA.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a lista reconhece a nota do ADN gravada ANTES da correção', () => {
    /** Exatamente como o acervo está hoje: rótulo antigo, campos achatados. */
    const acervoAntigo = {
        id: 'antigo', tipo: 'nfseNacional', tipoDoc: 'nfseNacional',
        chave: 'NFS3550308000000000000000000000000000000000000000009',
        numero: '900', dataEmissao: '2026-07-15T09:30:00-03:00',
        prestadorCnpj: EMPRESA, tomadorCnpj: TERCEIRO,
        valorServico: 4000, valorIss: 200,
        empresaCnpj: EMPRESA,
    } as any;

    it('ela não é mais lida como nota de MERCADORIA', () => {
        expect(getView(acervoAntigo).tipo).toBe('NFSe');
    });

    // A régua não pode inverter o caso comum.
    it('e a NF-e continua NF-e', () => {
        const nfe = { id: 'n', tipo: 'NFe', emitente: { cnpjCpf: TERCEIRO }, totais: { vNF: 100 } };
        expect(getView(nfe as any).tipo).toBe('NFe');
    });

    it('documento sem rótulo nenhum segue no default conservador', () => {
        expect(getView({ id: 'x', totais: { vNF: 10 } } as any).tipo).toBe('NFe');
    });
});
