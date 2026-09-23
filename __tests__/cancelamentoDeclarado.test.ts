/**
 * 🚨 A NOTA FOI CANCELADA DEPOIS DA CAPTURA — e não havia como dizer isso.
 *
 * 10/09, Paulo (JG SOLUCOES EM TECNOLOGIA · Barueri · NFS-e 76 de R$ 15.004,06):
 * *"essas duas notas são canceladas, importei as notas pelo portal nacional e
 * as mesmas subiram como ativas … poderia existir um campo para cancelarmos
 * quando acontecer isso"*.
 *
 * O Padrão Nacional entregou a nota como ela estava quando foi transcrita
 * (`status: autorizado`); o cancelamento aconteceu DEPOIS, no portal da
 * PREFEITURA, com quem o CFI não fala. Enquanto ninguém pudesse declarar, a
 * nota cancelada somava no faturamento, no Livro e no bloco A — e nenhum
 * validador acusa, porque o documento é legítimo.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    declararNotaCancelada, removerCancelamentoDeclarado, MIN_MOTIVO_CANCELAMENTO,
} from '../services/cancelamentoDeclarado';
import { docCancelado, origemDoCancelamento, CAMPOS_PARA_DOC_CANCELADO } from '../sefaz-backend/xml-metadata-helper.js';

const AUTOR = { uid: 'u1', email: 'sandra@spassessoriacontabil.com.br' };
const MOTIVO = 'cancelada no portal de Barueri, PDF com carimbo CANCELADA';
const AGORA = new Date('2026-09-10T12:00:00.000Z');
// O documento como o ADN o entregou: nota VÁLIDA pelo que a fonte disse.
const notaDoAdn = () => ({ id: 'doc1', numero: '76', status: 'autorizado' });

describe('a declaração de cancelamento', () => {
    it('grava quem afirmou, quando e por quê — e NÃO reescreve o status capturado', () => {
        const r = declararNotaCancelada(notaDoAdn(), MOTIVO, AUTOR, AGORA);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.patch).toEqual({
            cancelamentoDeclarado: {
                em: '2026-09-10T12:00:00.000Z',
                por: 'u1',
                porEmail: 'sandra@spassessoriacontabil.com.br',
                motivo: MOTIVO,
            },
        });
        // 🚨 O `status` fica como veio: ele é a PROVA do que a fonte disse, e é
        // contra ele que a declaração se confere depois (régua de 04/09 —
        // correção é DECLARAÇÃO sobre o documento, nunca reescrita dele).
        expect(Object.keys(r.patch)).toEqual(['cancelamentoDeclarado']);
    });

    it('exige motivo escrito — marcar como cancelada uma nota que vale APAGA RECEITA', () => {
        const curto = declararNotaCancelada(notaDoAdn(), 'cancelou', AUTOR, AGORA);
        expect(curto.ok).toBe(false);
        if (curto.ok) return;
        expect(curto.motivo).toMatch(new RegExp(String(MIN_MOTIVO_CANCELAMENTO)));
        expect(curto.motivo).toMatch(/APAGA RECEITA/);
    });

    it('exige autor — decisão que apaga receita não pode ser clique anônimo', () => {
        const semAutor = declararNotaCancelada(notaDoAdn(), MOTIVO, { uid: '', email: '' }, AGORA);
        expect(semAutor.ok).toBe(false);
    });

    it('recusa quando o PRÓPRIO documento já diz cancelado — não há o que declarar', () => {
        for (const doc of [
            { id: 'd', numero: '1', status: 'cancelado' },
            { id: 'd', numero: '1', status: 'autorizado', cStat: '101' },
            { id: 'd', numero: '1', status: 'autorizado', eventos: [{ tpEvento: '110111', cStat: '135' }] },
        ]) {
            const r = declararNotaCancelada(doc as any, MOTIVO, AUTOR, AGORA);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.motivo).toMatch(/já consta como cancelada/i);
        }
    });

    it('recusa a segunda declaração — repetir apagaria o autor e o motivo originais', () => {
        const jaDeclarada = { ...notaDoAdn(), cancelamentoDeclarado: { em: '2026-09-01T00:00:00Z', motivo: 'x' } };
        const r = declararNotaCancelada(jaDeclarada as any, MOTIVO, AUTOR, AGORA);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.motivo).toMatch(/↩/);
    });

    it('a consequência vai DITA no aviso — o número muda e quem confere precisa saber', () => {
        const r = declararNotaCancelada(notaDoAdn(), MOTIVO, AUTOR, AGORA);
        if (!r.ok) throw new Error('deveria aceitar');
        expect(r.avisoDepois).toMatch(/faturamento/i);
        expect(r.avisoDepois).toMatch(/não é apagado/i);
        expect(r.avisoDepois).toMatch(/voltar atrás/i);
    });
});

describe('o ↩ nasce junto do botão que tira do total (14/08)', () => {
    it('remove a declaração APAGANDO o campo — objeto vazio deixaria a nota fora do livro', () => {
        const doc = { ...notaDoAdn(), cancelamentoDeclarado: { em: '2026-09-01T00:00:00Z', motivo: 'x' } };
        const r = removerCancelamentoDeclarado(doc as any);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.patch).toEqual({ cancelamentoDeclarado: null });
        expect(r.avisoDepois).toMatch(/volta a contar/i);
    });

    it('não remove o que não existe', () => {
        expect(removerCancelamentoDeclarado(notaDoAdn() as any).ok).toBe(false);
    });
});

describe('🚨 quem faz a declaração VALER é o DONO da leitura', () => {
    // Uma declaração que só a tela honrasse seria a "régua que só escreve": o
    // faturamento continuaria inflado e a pessoa acharia que resolveu.
    it('docCancelado honra a declaração sobre nota que a fonte diz autorizada', () => {
        expect(docCancelado(notaDoAdn())).toBe(false);
        expect(docCancelado({ ...notaDoAdn(), cancelamentoDeclarado: { em: '2026-09-10T12:00:00Z' } })).toBe(true);
    });

    it('declaração vazia NÃO cancela — o ↩ grava null, e meio objeto não é declaração', () => {
        expect(docCancelado({ ...notaDoAdn(), cancelamentoDeclarado: null })).toBe(false);
        expect(docCancelado({ ...notaDoAdn(), cancelamentoDeclarado: {} })).toBe(false);
        expect(docCancelado({ ...notaDoAdn(), cancelamentoDeclarado: { em: '   ' } })).toBe(false);
    });

    it('a ORIGEM sai carimbada — número derivado de declaração não se apresenta como lido', () => {
        expect(origemDoCancelamento(notaDoAdn())).toBe(null);
        expect(origemDoCancelamento({ status: 'cancelado' })).toBe('documento');
        expect(origemDoCancelamento({ ...notaDoAdn(), cancelamentoDeclarado: { em: 'x' } })).toBe('declarado');
    });

    it('o campo está na lista que as projeções têm de carregar', () => {
        // Campo fora da projeção some da leitura, e a régua responde "não
        // cancelada" com toda confiança (a lição de 22/08).
        expect([...CAMPOS_PARA_DOC_CANCELADO]).toContain('cancelamentoDeclarado');
    });
});

describe('a saída nasce ONDE a trava aparece', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/xml/XmlDocumentoDetalhe.tsx'), 'utf8');

    it('o botão está no detalhe do documento, ao lado das outras decisões por nota', () => {
        expect(tela).toMatch(/Esta nota está CANCELADA/);
        expect(tela).toMatch(/marcarNotaCancelada/);
        expect(tela).toMatch(/desmarcarNotaCancelada/);
    });

    it('e ele NÃO aparece quando o próprio documento já diz cancelado', () => {
        // Oferecer ali convidaria a pôr carimbo humano sobre fato do órgão.
        expect(tela).toMatch(/origemDoCancelamento\(d as any\) === 'documento' \? null/);
    });

    it('a consequência é dita ANTES do clique, e a declaração fica carimbada na tela', () => {
        expect(tela).toMatch(/apaga receita do livro/i);
        expect(tela).toMatch(/cancelamentoDeclarado\?\.porEmail/);
        expect(tela).toMatch(/cancelamentoDeclarado\?\.motivo/);
    });
});
