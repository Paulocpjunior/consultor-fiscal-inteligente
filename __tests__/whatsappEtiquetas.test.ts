/**
 * 🏷 Etiquetas (flags) do contato.
 *
 * Etiqueta parece enfeite de tela e não é: dizer que um número é "lead",
 * "candidato" ou "marketing" é CLASSIFICAR UMA PESSOA — tratamento de dado
 * pessoal com finalidade, que a LGPD (art. 6º, I e art. 7º) exige que seja
 * específica e tenha base legal.
 *
 * As travas aqui separam as duas naturezas, e a diferença é o que impede
 * tanto o vazamento quanto o alarme inútil:
 *   · classificar é organização interna ⇒ pendência ACENDE, não bloqueia;
 *   · ENVIAR comunicação que depende de consentimento ⇒ RECUSA, porque a
 *     mensagem enviada não volta.
 */
import {
    ETIQUETAS_PADRAO, BASES_LEGAIS, validarEtiqueta, montarCatalogoEtiquetas,
    validarEtiquetasDoContato, pendenciasLgpdDoContato, podeEnviarPorEtiqueta,
    filtrarContatos, normalizarIdEtiqueta,
} from '../sefaz-backend/whatsapp-etiquetas';

const catalogo = montarCatalogoEtiquetas([]);

describe('catálogo padrão', () => {
    it('traz as etiquetas que o Paulo pediu', () => {
        const ids = ETIQUETAS_PADRAO.map((e) => e.id);
        ['lead', 'cliente', 'marketing', 'colaborador', 'candidato'].forEach((i) => expect(ids).toContain(i));
    });

    it('🚨 TODA etiqueta padrão já nasce com finalidade e base legal válida', () => {
        // Etiqueta sem finalidade é o "prazo órfão" do calendário municipal:
        // daqui a três meses ninguém lembra por que ela existe — e quando o
        // titular perguntar, a resposta precisa existir ANTES da pergunta.
        ETIQUETAS_PADRAO.forEach((e) => {
            expect(e.finalidade.length).toBeGreaterThan(15);
            expect(BASES_LEGAIS[e.baseLegal]).toBeTruthy();
        });
    });

    it('só MARKETING pede consentimento entre as padrão — alarme onde não há ação é o que ensina a ignorar alarme', () => {
        const pedem = ETIQUETAS_PADRAO.filter((e) => BASES_LEGAIS[e.baseLegal].pedeConsentimento).map((e) => e.id);
        expect(pedem).toEqual(['marketing']);
    });

    it('o cadastro do admin VENCE o padrão no mesmo id, e etiqueta desativada some', () => {
        const c = montarCatalogoEtiquetas([
            { id: 'lead', rotulo: 'Prospect', cor: 'lime', ordem: 1, finalidade: 'x'.repeat(20), baseLegal: 'preliminares' },
            { id: 'ex-cliente', ativa: false },
        ]);
        expect(c.find((e) => e.id === 'lead')!.rotulo).toBe('Prospect');
        expect(c.find((e) => e.id === 'lead')!.origem).toBe('padrao-editado');
        expect(c.find((e) => e.id === 'ex-cliente')).toBeUndefined();
    });
});

describe('validarEtiqueta', () => {
    it('🚨 RECUSA etiqueta sem finalidade — e a recusa ENSINA por quê', () => {
        const r = validarEtiqueta({ rotulo: 'VIP', baseLegal: 'legitimo' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/finalidade|PARA QUE/i);
    });

    it('🚨 RECUSA etiqueta sem base legal, listando as opções', () => {
        const r = validarEtiqueta({ rotulo: 'VIP', finalidade: 'Clientes de atendimento prioritário do escritório.' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/base legal/i);
    });

    it('aceita a etiqueta completa e normaliza o id (é chave, não texto de tela)', () => {
        const r = validarEtiqueta({ rotulo: 'Ex Sócio Ativo', finalidade: 'Antigos sócios que seguem em contato.', baseLegal: 'legitimo' });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.etiqueta.id).toBe('ex-socio-ativo');
    });

    it('id normalizado tira acento e espaço', () => {
        expect(normalizarIdEtiqueta('Indicação Comercial')).toBe('indicacao-comercial');
    });

    it('cor fora da paleta cai no neutro em vez de quebrar a tela', () => {
        const r = validarEtiqueta({ rotulo: 'X', cor: 'fuchsia-neon', finalidade: 'Uma finalidade escrita aqui.', baseLegal: 'legitimo' });
        expect(r.ok && r.etiqueta.cor).toBe('slate');
    });
});

describe('etiqueta do contato', () => {
    it('recusa id que não existe no catálogo — id solto vira dado órfão', () => {
        const r = validarEtiquetasDoContato(['cliente', 'inventada'], catalogo);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.desconhecidas).toEqual(['inventada']);
    });

    it('tira repetido e normaliza', () => {
        const r = validarEtiquetasDoContato(['Cliente', 'cliente', 'lead'], catalogo);
        expect(r.ok && r.etiquetas).toEqual(['cliente', 'lead']);
    });
});

describe('🚨 pendências de LGPD — ACENDEM, não bloqueiam', () => {
    it('marketing sem consentimento registrado acende, com a ação do lado', () => {
        const p = pendenciasLgpdDoContato({ numero: '5511', etiquetas: ['marketing'] }, catalogo);
        expect(p).toHaveLength(1);
        expect(p[0].tipo).toBe('sem-consentimento');
        expect(p[0].acao).toMatch(/não envie campanha/i);
    });

    it('cliente NÃO acende — base é contrato, e alarme sem ação vira ruído', () => {
        expect(pendenciasLgpdDoContato({ numero: '5511', etiquetas: ['cliente', 'lead'] }, catalogo)).toEqual([]);
    });

    it('marketing COM consentimento registrado não acende', () => {
        const p = pendenciasLgpdDoContato(
            { numero: '5511', etiquetas: ['marketing'], consentimentos: { marketing: { em: '2026-08-10' } } }, catalogo);
        expect(p).toEqual([]);
    });

    it('consentimento REVOGADO acende sozinho — revogar vale na hora (art. 18, IX)', () => {
        const p = pendenciasLgpdDoContato(
            { numero: '5511', etiquetas: ['marketing'], consentimentos: { marketing: { em: '2026-01-01', revogadoEm: '2026-08-15' } } },
            catalogo);
        expect(p.map((x) => x.tipo)).toContain('consentimento-revogado');
    });

    it('etiqueta que sumiu do catálogo NÃO passa calada', () => {
        const p = pendenciasLgpdDoContato({ numero: '5511', etiquetas: ['fantasma'] }, catalogo);
        expect(p[0].tipo).toBe('etiqueta-desconhecida');
    });
});

describe('🚨 podeEnviarPorEtiqueta — aqui é RECUSA, porque a mensagem não volta', () => {
    it('sem consentimento, não envia', () => {
        const r = podeEnviarPorEtiqueta({ numero: '5511', etiquetas: ['marketing'] }, 'marketing', catalogo);
        expect(r.pode).toBe(false);
        expect(r.motivo).toMatch(/consentimento/i);
    });

    it('com consentimento, envia', () => {
        const r = podeEnviarPorEtiqueta(
            { numero: '5511', consentimentos: { marketing: { em: '2026-08-10' } } }, 'marketing', catalogo);
        expect(r.pode).toBe(true);
    });

    it('revogado vence consentimento antigo — o mais recente manda, e ele é o "não"', () => {
        const r = podeEnviarPorEtiqueta(
            { numero: '5511', consentimentos: { marketing: { em: '2026-01-01', revogadoEm: '2026-08-15' } } },
            'marketing', catalogo);
        expect(r.pode).toBe(false);
        expect(r.motivo).toMatch(/revogou/i);
    });

    it('natureza que não depende de consentimento passa (cobrar aqui seria travar o atendimento)', () => {
        expect(podeEnviarPorEtiqueta({ numero: '5511' }, 'cliente', catalogo).pode).toBe(true);
    });

    it('etiqueta inexistente não é liberada por omissão', () => {
        expect(podeEnviarPorEtiqueta({ numero: '5511' }, 'fantasma', catalogo).pode).toBe(false);
    });
});

describe('filtrarContatos', () => {
    const lista = [
        { numero: '5511999990001', nomePerfil: 'Maria Souza', etiquetas: ['cliente'] },
        { numero: '5511999990002', nomePerfil: 'João Lima', empresaNomeSugerido: 'PADARIA BOM PÃO', etiquetas: ['lead'] },
        { numero: '5511999990003', etiquetas: [] },
    ];

    it('acha por nome, por empresa e por pedaço do número', () => {
        expect(filtrarContatos(lista, { busca: 'maria' })).toHaveLength(1);
        expect(filtrarContatos(lista, { busca: 'padaria' })).toHaveLength(1);
        expect(filtrarContatos(lista, { busca: '90002' })).toHaveLength(1);
    });

    it('busca curta de número não vira filtro maluco', () => {
        // 2 dígitos casariam quase tudo; a busca por texto continua valendo.
        expect(filtrarContatos(lista, { busca: '55' })).toHaveLength(0);
    });

    it('filtra por etiqueta e acha quem está SEM etiqueta (é a fila de trabalho)', () => {
        expect(filtrarContatos(lista, { etiqueta: 'lead' })).toHaveLength(1);
        expect(filtrarContatos(lista, { semEtiqueta: true })).toHaveLength(1);
    });

    it('sem filtro, devolve todo mundo — lista que esconde por padrão faz achar que o banco está vazio', () => {
        expect(filtrarContatos(lista, {})).toHaveLength(3);
    });
});
