// ============================================================================
// 📭 "fechamento de mês de empresas sem movimento" (Paulo, 23/09, E7
// ASSESSORIA ESPORTIVA 08/2026): etapas 1 e 2 vermelhas para sempre numa
// empresa que não emitiu nem recebeu nada. O que este teste prende: a porta
// só existe com ZERO documento; a declaração exige texto, data e autor; ela
// fecha as etapas 1 e 2 NOMEADA; e CAI sozinha se documento chegar depois.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    podeDeclararSemMovimento, conferirDeclaracaoSemMovimento, aplicarSemMovimentoDeclarado,
    textoDaDeclaracaoSemMovimento, MOTIVO_MINIMO,
} from '../sefaz-backend/sem-movimento-declarado.js';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal, etapaFechada } from '../sefaz-backend/rotina-fiscal.js';
import { bloqueioDaEtapa, podeDarFimDeMes } from '../sefaz-backend/fim-de-mes.js';

const DECL = { comoFoi: 'Cliente confirmou por e-mail que não emitiu nem recebeu nota em 08/2026.', quando: '2026-09-22', declaradoPor: 'sandra@sp' };
const capturaPendente = { id: 'captura', status: 'pendente', resumo: 'Nenhuma nota capturada nesta competência.', acao: 'Rode a captura.' };
const validacaoPendente = { id: 'validacao', status: 'pendente', resumo: 'Sem notas para validar.', acao: 'Conclua a captura primeiro.' };

describe('🚨 quem PODE declarar — só com zero documento', () => {
    it('zero documento e captura cobrando → pode', () => {
        expect(podeDeclararSemMovimento({ documentos: [], captura: capturaPendente })).toBe(true);
    });
    it('com documento NÃO pode — nota capturada não é "sem movimento"', () => {
        expect(podeDeclararSemMovimento({ documentos: [{ id: 'x' }], captura: capturaPendente })).toBe(false);
    });
    it('locação pura (na) e captura concluída não oferecem a porta; já declarada também não', () => {
        expect(podeDeclararSemMovimento({ documentos: [], captura: { ...capturaPendente, status: 'na' } })).toBe(false);
        expect(podeDeclararSemMovimento({ documentos: [], captura: { ...capturaPendente, status: 'concluida' } })).toBe(false);
        expect(podeDeclararSemMovimento({ documentos: [], captura: { ...capturaPendente, semMovimentoDeclarado: true } })).toBe(false);
    });
});

describe('a declaração é conferida antes de gravar', () => {
    it('aceita texto com piso, data não futura e autor', () => {
        const r: any = conferirDeclaracaoSemMovimento({ ...DECL, quem: 'sandra@sp', hojeIso: '2026-09-23' });
        expect(r.ok).toBe(true);
        expect(r.declaracao).toEqual(DECL);
    });
    it('recusa texto curto, data no futuro, data ilegível e sem autor — com a frase', () => {
        expect((conferirDeclaracaoSemMovimento({ comoFoi: 'ok', quando: '2026-09-22', quem: 'x' }) as any).erro).toMatch(new RegExp(`mínimo ${MOTIVO_MINIMO}`));
        expect((conferirDeclaracaoSemMovimento({ ...DECL, quando: '2026-09-30', quem: 'x', hojeIso: '2026-09-23' }) as any).erro).toMatch(/futuro/);
        expect((conferirDeclaracaoSemMovimento({ ...DECL, quando: '22/09/2026', quem: 'x' }) as any).erro).toMatch(/AAAA-MM-DD/);
        expect((conferirDeclaracaoSemMovimento({ ...DECL, quem: '' }) as any).erro).toMatch(/Sessão/);
    });
});

describe('aplicar: fecha as etapas 1 e 2 NOMEADA — e cai se documento chegar', () => {
    it('sem documento: captura e validação viram "na", com quem, quando e o texto', () => {
        const r = aplicarSemMovimentoDeclarado({ captura: capturaPendente, validacao: validacaoPendente, documentos: [], declaracao: DECL });
        expect(r.aplicada).toBe(true);
        expect(r.captura.status).toBe('na');
        expect(r.validacao.status).toBe('na');
        expect(r.captura.resumo).toContain('Sem movimento DECLARADO por sandra@sp em 22/09/2026');
        expect(r.captura.resumo).toContain('NÃO tem prova');
        expect(r.captura.resumo).toContain('(antes: Nenhuma nota capturada');
        expect(r.captura.semMovimentoDeclarado).toBe(true);
        expect(r.captura.podeDeclararSemMovimento).toBe(false);
        expect(textoDaDeclaracaoSemMovimento(DECL)).toContain('não capturou documento nenhum');
    });
    it('com documento depois: a declaração CAI, a etapa segue a régua normal e a ressalva vai dita', () => {
        const capturaOk = { id: 'captura', status: 'concluida', resumo: '1 entrada(s) e 1 saída(s).', acao: null };
        const r = aplicarSemMovimentoDeclarado({ captura: capturaOk, validacao: validacaoPendente, documentos: [{ id: 'a' }, { id: 'b' }], declaracao: DECL });
        expect(r.aplicada).toBe(false);
        expect(r.caiu).toBe(true);
        expect(r.captura.status).toBe('concluida');
        expect(r.captura.resumo).toContain('2 documento(s) chegaram depois — a declaração caiu');
        expect(r.validacao).toBe(validacaoPendente);
    });
    it('sem declaração nada muda', () => {
        const r = aplicarSemMovimentoDeclarado({ captura: capturaPendente, validacao: validacaoPendente, documentos: [] });
        expect(r.captura).toBe(capturaPendente);
    });
});

describe('na Rotina e no fim de mês', () => {
    const empresa = { id: 'e7', nome: 'E7 ASSESSORIA ESPORTIVA', cnpj: '15835908000192', regimePadrao: 'presumido' };
    const base = {
        empresa, competencia: '2026-08', documentos: [], apuracao: { fonte: 'lucro', totalImpostos: 0 },
        tarefas: [{ id: 't', empresaId: 'e7', obrigacao: 'DCTFWEB', status: 'concluida', competencia: '08/2026', vencimento: new Date('2026-09-30') }],
        envios: [], agoraMs: Date.parse('2026-09-23T12:00:00Z'),
    };
    it('sem declaração: etapa 1 pendente, com a porta; fim de mês bloqueado com podeDeclararSemMovimento', () => {
        const r: any = montarRotinaFiscal(base);
        const e1 = r.etapas.find((e: any) => e.id === 'captura');
        expect(e1.status).toBe('pendente');
        expect(e1.podeDeclararSemMovimento).toBe(true);
        const pre = podeDarFimDeMes(r);
        expect(pre.pode).toBe(false);
        expect(pre.bloqueios.find((b: any) => b.id === 'captura')!.podeDeclararSemMovimento).toBe(true);
        expect(bloqueioDaEtapa({ id: 'guias', status: 'pendente' } as any).podeDeclararSemMovimento).toBeNull();
    });
    it('com declaração e zero documento: as cinco etapas fecham e o mês pode fechar', () => {
        const r: any = montarRotinaFiscal({ ...base, declaracaoSemMovimento: DECL });
        expect(r.etapas.every((e: any) => etapaFechada(e))).toBe(true);
        expect(r.farol).toBe('ok');
        expect(r.etapas[0].resumo).toContain('DECLARADO por sandra@sp');
        expect(podeDarFimDeMes(r).pode).toBe(true);
    });
    it('a porta existe: rota, serviço e botão na tela', () => {
        const raiz = join(__dirname, '..');
        expect(readFileSync(join(raiz, 'sefaz-backend', 'rotina-fiscal-routes.js'), 'utf8')).toContain("router.post('/sem-movimento-declarado'");
        expect(readFileSync(join(raiz, 'services', 'rotinaFiscalService.ts'), 'utf8')).toContain('export async function declararSemMovimento');
        expect(readFileSync(join(raiz, 'components', 'FimDeMesBloco.tsx'), 'utf8')).toContain('Esta empresa não teve movimento no mês — declarar');
    });
});
