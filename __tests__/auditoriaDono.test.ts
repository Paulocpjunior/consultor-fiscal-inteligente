// ============================================================================
// Relatório de auditoria do DONO (Paulo, 16/08: "só eu devo ter acesso").
// As duas coisas que este teste protege: a TRAVA de acesso (ausência de
// config FECHA) e a HONESTIDADE do número (trilha não lida nunca vira zero,
// e trilha nova diz desde quando existe).
// ============================================================================
import {
    DONOS_PADRAO, donosConfigurados, ehDono, TRILHAS, paraIso,
    descreverEvento, normalizarEvento, montarAuditoria, ressalvasDoPeriodo,
} from '../sefaz-backend/auditoria-dono.js';

describe('trava de acesso — aqui a ausência de configuração FECHA', () => {
    it('sem env, valem os donos padrão; com env, ela manda', () => {
        expect(donosConfigurados({})).toEqual(DONOS_PADRAO);
        expect(donosConfigurados({ AUDITORIA_DONO_EMAILS: 'so.eu@sp.com.br' })).toEqual(['so.eu@sp.com.br']);
        expect(ehDono('junior@spassessoriacontabil.com.br', {})).toBe(true);
        expect(ehDono('JUNIOR@SPassessoriacontabil.com.BR', {})).toBe(true);
    });

    it('outro admin NÃO entra — é o contrário do painel Sistema→Banco, e de propósito', () => {
        expect(ehDono('colaborador@spassessoriacontabil.com.br', {})).toBe(false);
        expect(ehDono('alexandre@spassessoriacontabil.com.br', {})).toBe(false);
    });

    it('sessão sem e-mail NUNCA passa — indeterminado aqui fecha', () => {
        expect(ehDono(null, {})).toBe(false);
        expect(ehDono('', {})).toBe(false);
        expect(ehDono('semarroba', {})).toBe(false);
        // env torta (sem @) não abre a porta pra ninguém por engano
        expect(ehDono('junior@spassessoriacontabil.com.br', { AUDITORIA_DONO_EMAILS: 'lixo;;;' })).toBe(true);
    });
});

describe('normalização dos eventos', () => {
    it('lê Timestamp do Firestore, Date e ISO; ilegível vira null (nunca "agora")', () => {
        expect(paraIso({ toDate: () => new Date('2026-08-16T12:00:00Z') })).toBe('2026-08-16T12:00:00.000Z');
        expect(paraIso(new Date('2026-08-16T12:00:00Z'))).toBe('2026-08-16T12:00:00.000Z');
        expect(paraIso('2026-08-16T12:00:00.000Z')).toBe('2026-08-16T12:00:00.000Z');
        expect(paraIso('ontem')).toBeNull();
        expect(paraIso(null)).toBeNull();
    });

    it('a descrição diz o que a pessoa fez, não só o nome da trilha', () => {
        expect(descreverEvento('dctfweb-transmissao', { empresaNome: 'ACME', competencia: '07/2026', retificadora: true }))
            .toContain('RETIFICADORA');
        expect(descreverEvento('pgdas-sem-movimento', { empresaNome: 'ELS', competencia: '07/2026' }))
            .toContain('SEM MOVIMENTO');
        expect(descreverEvento('permissao', { alvoEmail: 'x@sp', campo: 'papelAtendimento', de: 'colaborador', para: 'gestor' }))
            .toContain('gestor');
    });

    it('evento normalizado leva quem, quando e o peso da ação', () => {
        const trilha = TRILHAS.find((t: any) => t.id === 'dctfweb-transmissao')!;
        const e = normalizarEvento(trilha, 'doc1', {
            transmitidoEm: '2026-08-16T12:00:00Z', transmitidoPor: 'ju@sp', empresaNome: 'ACME', competencia: '07/2026',
        });
        expect(e).toMatchObject({ trilha: 'dctfweb-transmissao', quem: 'ju@sp', peso: 'critico', empresa: 'ACME' });
        expect(e.em).toBe('2026-08-16T12:00:00.000Z');
    });
});

describe('montagem — o silêncio nunca passa por "nada aconteceu"', () => {
    const trilhaGuia = TRILHAS.find((t: any) => t.id === 'imposto-enviado')!;
    const trilhaDctf = TRILHAS.find((t: any) => t.id === 'dctfweb-transmissao')!;

    it('agrega por pessoa e por trilha, com o mais recente em cima', () => {
        const r = montarAuditoria({
            leituras: [
                { trilha: trilhaGuia, docs: [
                    { id: 'a', dados: { enviadoEm: '2026-08-10T10:00:00Z', enviadoPor: 'ju@sp', tipo: 'DAS' } },
                    { id: 'b', dados: { enviadoEm: '2026-08-12T10:00:00Z', enviadoPor: 'ju@sp', tipo: 'DARF' } },
                ] },
                { trilha: trilhaDctf, docs: [
                    { id: 'c', dados: { transmitidoEm: '2026-08-11T10:00:00Z', transmitidoPor: 'ana@sp' } },
                ] },
            ],
        });
        expect(r.total).toBe(3);
        expect(r.eventos[0].id).toBe('imposto-enviado:b');   // mais recente primeiro
        expect(r.porPessoa[0]).toEqual({ quem: 'ju@sp', quantidade: 2 });
        expect(r.porTrilha.find((t: any) => t.trilha === 'dctfweb-transmissao')?.quantidade).toBe(1);
    });

    it('TRILHA QUE FALHOU vira "não lida" e RESSALVA — nunca zero', () => {
        const r = montarAuditoria({
            leituras: [
                { trilha: trilhaGuia, docs: [{ id: 'a', dados: { enviadoEm: '2026-08-10T10:00:00Z', enviadoPor: 'ju@sp' } }] },
                { trilha: trilhaDctf, erro: 'permission denied' },
            ],
        });
        expect(r.total).toBe(1);
        expect(r.naoLidas).toEqual([{ trilha: 'dctfweb-transmissao', rotulo: 'DCTFWeb transmitida', motivo: 'permission denied' }]);
        expect(r.ressalvas.join(' ')).toContain('INCOMPLETO');
    });

    it('filtra por período e por pessoa — e evento SEM DATA não some da conta', () => {
        const leituras = [{ trilha: trilhaGuia, docs: [
            { id: 'a', dados: { enviadoEm: '2026-07-01T10:00:00Z', enviadoPor: 'ju@sp' } },
            { id: 'b', dados: { enviadoEm: '2026-08-15T10:00:00Z', enviadoPor: 'ana@sp' } },
            { id: 'c', dados: { enviadoPor: 'ju@sp' } },   // sem data
        ] }];
        const r = montarAuditoria({ leituras, de: '2026-08-01T00:00:00Z' });
        expect(r.total).toBe(2);                    // a de julho sai, a SEM DATA fica
        expect(r.semData).toBe(1);
        const so = montarAuditoria({ leituras, quemFiltro: 'ANA@sp' });
        expect(so.total).toBe(1);
    });

    it('trilha mais NOVA que o período diz desde quando existe — senão o vazio vira "ninguém mexeu"', () => {
        const r = ressalvasDoPeriodo({ de: '2026-01-01T00:00:00Z' });
        expect(r.join(' ')).toContain('Permissão alterada');
        expect(r.join(' ')).toContain('16/08/2026');
        // e o relatório sempre diz o que ele NÃO é
        expect(r.join(' ')).toContain('não prova ausência de ação');
    });

    it('evento sem autor é CONTADO e explicado (registro antigo, antes do carimbo)', () => {
        const r = montarAuditoria({ leituras: [{ trilha: trilhaGuia, docs: [
            { id: 'a', dados: { enviadoEm: '2026-08-10T10:00:00Z' } },
        ] }] });
        expect(r.semAutor).toBe(1);
        expect(r.porPessoa[0].quem).toBe('(não registrado)');
        expect(r.ressalvas.join(' ')).toContain('sem autor');
    });
});
