/**
 * T1/T3/T5 — quem transmite a DCTFWeb e sob que condições.
 *
 * Decisões do Paulo (12/08/2026): o dono é o FISCAL, e transmitir com insumo
 * pendente é JUSTIFICATIVA GRAVADA, não bloqueio (bloquear puro faria perder o
 * dia 15 por um insumo que talvez não venha — multa certa contra retificadora
 * barata).
 */
// @ts-nocheck — módulo .js do backend
import {
    podeTransmitirDctfweb, checarJustificativa, checarRetificadora, compararDebitos,
} from '../sefaz-backend/dctfweb-transmissao-regras.js';

describe('T1 — o dono da transmissão é o fiscal', () => {
    it('admin passa sempre', () => {
        expect(podeTransmitirDctfweb({ role: 'admin' }).pode).toBe(true);
    });

    it('quem é do fiscal passa', () => {
        expect(podeTransmitirDctfweb({ departamentos: ['fiscal'] }).pode).toBe(true);
    });

    it('quem é de outro departamento é barrado — e a recusa aponta a GUIA', () => {
        const r = podeTransmitirDctfweb({ departamentos: ['contabil'] });
        expect(r.pode).toBe(false);
        expect(r.motivo).toMatch(/departamento FISCAL/);
        // A recusa não pode ser só "não pode": o Contábil quase sempre quer a
        // guia, e a guia sai sem transmitir.
        expect(r.acao).toMatch(/Gerar DARF/);
        expect(r.acao).toMatch(/sem transmitir/);
    });

    it('sem departamento nenhum, manda vincular — não manda trocar senha', () => {
        const r = podeTransmitirDctfweb({});
        expect(r.pode).toBe(false);
        expect(r.motivo).toMatch(/não é troca de senha/);
    });
});

describe('T3 — insumo pendente exige justificativa gravada', () => {
    it('semáforo completo não pede nada', () => {
        expect(checarJustificativa({ veredito: 'pronto' }).ok).toBe(true);
    });

    it('incerto (consulta caída) também não trava', () => {
        expect(checarJustificativa({ veredito: 'incerto' }).ok).toBe(true);
    });

    it('incompleto sem confirmação: barra e explica', () => {
        const r = checarJustificativa({ veredito: 'incompleto', confirmou: false });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/quem seguiu e por quê/);
    });

    it('confirmou mas escreveu "ok": não passa — justificativa curta não explica nada', () => {
        const r = checarJustificativa({ veredito: 'incompleto', confirmou: true, justificativa: 'ok' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/mínimo 15 caracteres/);
    });

    it('justificativa de verdade passa e volta limpa', () => {
        const r = checarJustificativa({
            veredito: 'incompleto', confirmou: true,
            justificativa: '  DP não fecha até o dia 15 e o prazo vence hoje  ',
        });
        expect(r.ok).toBe(true);
        expect(r.justificativa).toBe('DP não fecha até o dia 15 e o prazo vence hoje');
    });
});

describe('T5 — retificadora', () => {
    it('não existe retificadora de declaração não transmitida', () => {
        const r = checarRetificadora({ declaracao: { situacao: 'EM_ANDAMENTO' }, motivo: 'motivo suficientemente longo' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/transmissão normal/);
    });

    it('exige motivo escrito', () => {
        const r = checarRetificadora({ declaracao: { situacao: 'ATIVA' }, motivo: 'erro' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/motivo da retificadora/);
    });

    it('com motivo, libera', () => {
        const r = checarRetificadora({
            declaracao: { transmitidoEm: '2026-08-12T10:00:00Z' },
            motivo: 'eSocial fechou dia 18, depois da transmissão dia 12',
        });
        expect(r.ok).toBe(true);
    });
});

describe('antes × depois da retificadora', () => {
    const antes = [
        { codReceita: '116201', valor: 5382.64 },
        { codReceita: '320806', valor: 18859.51 },
    ];

    it('mostra o que entrou, o que mudou e o total', () => {
        const depois = [
            { codReceita: '116201', valor: 5382.64 },
            { codReceita: '320806', valor: 18859.51 },
            { codReceita: '056107', valor: 606.71 },
        ];
        const c = compararDebitos(antes, depois);
        expect(c.linhas).toHaveLength(1);
        expect(c.linhas[0]).toMatchObject({ codReceita: '056107', tipo: 'incluido', delta: 606.71 });
        expect(c.deltaTotal).toBe(606.71);
        expect(c.semEfeito).toBe(false);
    });

    it('valor alterado aparece com antes e depois', () => {
        const c = compararDebitos(antes, [{ codReceita: '116201', valor: 6000 }, { codReceita: '320806', valor: 18859.51 }]);
        expect(c.linhas[0]).toMatchObject({ codReceita: '116201', antes: 5382.64, depois: 6000, tipo: 'alterado' });
    });

    it('retificadora que não mudou NADA é sinalizada — senão a pessoa acha que resolveu', () => {
        const c = compararDebitos(antes, antes);
        expect(c.semEfeito).toBe(true);
        expect(c.deltaTotal).toBe(0);
    });
});
