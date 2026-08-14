// ============================================================================
// A NOTA PRÓPRIA DE ENTRADA VOLTOU A VIRAR "SAÍDA" — e o FUNRURAL contou a
// nota do PRODUTOR no lugar da nota da empresa.
//
// Paulo, 14/08, urgente (NOVA ERA 29.240.822/0001-21, competência 07/2026):
// *"o CFI está levando a notas dele e não está considerando a da NOVA ERA"* —
// notas 255273, 255274, 255585, 255746, 256121, 256336, 256341, 256445, 256580,
// 257257, 257427, 258043, de JOSE D. KOKI, EWERTON RENE, NUNO MONTEIRO e COSME
// QUEIROZ. Ele desconfiou do CADASTRO dos produtores; o defeito estava antes
// disso, no IMPORT.
//
// ═══ A CADEIA, do defeito ao sintoma ════════════════════════════════════════
//
// Compra de produtor rural PF é **NOTA PRÓPRIA DE ENTRADA** (RICMS/SP art. 136,
// I, "a"): o produtor não emite NF-e, então quem emite é o ADQUIRENTE, com
// `tpNF=0`. A nota tem `emit = NOVA ERA` e mesmo assim é ENTRADA.
//
//   1. o import decidiu "emit == empresa ⇒ SAÍDA" e ignorou o tpNF
//   2. a DIPAM/FUNRURAL só olha ENTRADAS ⇒ a nota da NOVA ERA sumiu da conta
//   3. sem ela, `dedupNotaProdutorComEntrada` não acha a nota própria que COBRE
//      a NF-e do produtor ⇒ a NF-e DELE deixa de ser excluída
//   4. o FUNRURAL passa a sair da nota do produtor — exatamente o documento que
//      o art. 136 manda NÃO escriturar
//
// ═══ E POR QUE ISSO REAPARECEU ══════════════════════════════════════════════
//
// A régua foi escrita em 31/07 (caso EDUARDO GUERRA) dentro do `xml-importer`.
// O caminho de importação MANUAL do frontend tinha a **segunda cópia**, e ela
// nunca recebeu a correção. Régua fiscal com duas cópias diverge — e diverge em
// silêncio, porque nada quebra: a nota entra, só entra do lado errado.
// ============================================================================
import { decidirDirecaoPorTpNF } from '../sefaz-backend/xml-metadata-helper.js';
import { dedupNotaProdutorComEntrada } from '../sefaz-backend/dipam-produtor-rural.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOVA_ERA = '29240822000121';
const NUNO = '00341924172';       // CPF, como o Paulo apontou
const EWERTON = '15097921000353'; // CNPJ — produtor PF com CNPJ (CAT 45/2008)

describe('o caso REAL da NOVA ERA', () => {
    it('nota própria de ENTRADA (tpNF=0) da NOVA ERA é ENTRADA, não saída', () => {
        // É a nota 255585 e as outras onze: emit = NOVA ERA, produtor no
        // destinatário, tpNF=0.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, NUNO, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF(NOVA_ERA, EWERTON, NOVA_ERA, '0')).toBe('entrada');
    });

    it('venda de verdade (tpNF=1) continua saída — a correção não inverteu nada', () => {
        expect(decidirDirecaoPorTpNF(NOVA_ERA, '11222333000181', NOVA_ERA, '1')).toBe('saida');
    });

    it('sem tpNF, emitente continua saída — é o comportamento antigo, e é o certo', () => {
        // Documento sem o campo não vira entrada por dedução: ausência não é
        // prova, e transformar toda nota antiga em entrada seria pior.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, '11222333000181', NOVA_ERA, null)).toBe('saida');
    });

    it('quando a empresa é a DESTINATÁRIA, o tpNF não muda nada', () => {
        // O tpNF é do EMITENTE. Lê-lo do lado de quem recebe seria inverter a
        // compra de um fornecedor comum.
        expect(decidirDirecaoPorTpNF('11222333000181', NOVA_ERA, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF('11222333000181', NOVA_ERA, NOVA_ERA, '1')).toBe('entrada');
    });

    it('CPF no destinatário não confunde — o eixo é o CNPJ da EMPRESA', () => {
        // Era a suspeita do Paulo ("a nota dele já vem com o CPF"). O CPF do
        // produtor nunca decidiu a direção; quem decidia era o `emit ===
        // empresa` sem tpNF.
        expect(decidirDirecaoPorTpNF(NOVA_ERA, NUNO, NOVA_ERA, '0')).toBe('entrada');
        expect(decidirDirecaoPorTpNF(NUNO, NOVA_ERA, NOVA_ERA, '1')).toBe('entrada');
    });
});

describe('a consequência: a dedup do art. 136 escolhia a nota ERRADA', () => {
    const nota = (over: Record<string, unknown> = {}) => ({
        chave: 'x', numero: '1', dhEmi: '2026-07-10', valor: 10000,
        fornecedor: { doc: NUNO, nome: 'NUNO MONTEIRO' },
        competencia: '2026-07',
        notaPropria: false,
        direcao: 'entrada',
        dipam: { aplica: true }, funrural: { aplica: true },
        ...over,
    });

    it('COM a nota própria de entrada, a NF-e do produtor sai da conta', () => {
        const r = dedupNotaProdutorComEntrada([
            nota({ numero: '255585', notaPropria: true }),
            nota({ numero: '900', notaPropria: false }),
        ]);
        const doProdutor = r.find((n: any) => n.numero === '900');
        const daEmpresa = r.find((n: any) => n.numero === '255585');
        expect(doProdutor.funrural.aplica).toBe(false);
        expect(doProdutor.notaOrigemProdutor).toBe(true);
        // A da EMPRESA é a que fica — é ela que se escritura (art. 136, I, "a").
        expect(daEmpresa.funrural.aplica).toBe(true);
    });

    it('SEM ela — que era o efeito do bug — a nota do produtor entra sozinha', () => {
        // Este teste descreve o ESTRAGO, e é por isso que ele existe: enquanto
        // a nota própria estava gravada como 'saida', ela não chegava aqui, e
        // a dedup não tinha o que parear. O FUNRURAL saía da nota do produtor.
        const r = dedupNotaProdutorComEntrada([nota({ numero: '900', notaPropria: false })]);
        expect(r[0].funrural.aplica).toBe(true);
        expect(r[0].notaOrigemProdutor).toBeUndefined();
    });
});

describe('o import manual grava o que o conserto do histórico precisa', () => {
    const parser = readFileSync(join(__dirname, '..', 'services/xmlParserService.ts'), 'utf8');

    it('o parser LÊ o tpNF do <ide>', () => {
        expect(parser).toMatch(/tpNF: getTextContent\(ide, 'tpNF'\) \|\| null/);
    });

    it('e GRAVA no documento — campo só em memória não conserta banco', () => {
        // `corrigirDirecaoEntradaPropria` (backfill do sync-cron) reconhece a
        // nota própria por tpNF==0 + direcao=='saida' + emit==empresa. Sem o
        // campo gravado, ele não tem como achar o que precisa consertar.
        expect(parser).toMatch(/tpNF: parsed\.tpNF \?\? null/);
    });

    it('e usa a régua ÚNICA, não uma cópia', () => {
        expect(parser).toMatch(/decidirDirecaoPorTpNF/);
        expect(parser).not.toMatch(/if \(emit === emp\) return \{ ok: true, direcao: 'saida' \}/);
    });
});
