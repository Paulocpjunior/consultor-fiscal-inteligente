/**
 * POR QUE a NFS-e saiu com ISS zerado.
 *
 * O painel aprendeu a não chamar isso de "sem movimento" (#513) e parou no
 * meio: 67 empresas com a MESMA frase "confira isenção/imunidade ou falha na
 * captura". Isso é meio farol — o colaborador vê 67 alertas iguais e não tem
 * por onde começar. A maioria das causas não pede ação NENHUMA; duas pedem,
 * porque são contradição dentro do próprio documento.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { classificarIssZerado, resumirCausasIssZerado, divergenciaRegimePelaNota } from '../sefaz-backend/iss-zerado-causa';

const nota = (over: any = {}) => ({
    tipoDoc: 'NFSe', direcao: 'saida', valorServicos: 1000, valorDeducoes: 0,
    aliquotaServicos: 5, issDevido: 0, municipioPrestacaoIbge: '3550308', ...over,
});

describe('causa do ISS zerado, nota a nota', () => {
    it('retido pelo tomador: quem recolhe é quem contratou', () => {
        const c = classificarIssZerado(nota({ issRetido: true }));
        expect(c.causa).toBe('retido');
        expect(c.exigeAcao).toBe(false);
    });

    it('prestador optante pela PRÓPRIA nota: o ISS vai no DAS', () => {
        const c = classificarIssZerado(nota({ prestadorOptanteSimples: true }));
        expect(c.causa).toBe('optante');
        expect(c.exigeAcao).toBe(false);
    });

    it('serviço prestado em outro município: o ISS é da prefeitura de lá', () => {
        const c = classificarIssZerado(nota({ municipioPrestacaoIbge: '3509502' }));
        expect(c.causa).toBe('fora-de-sp');
        expect(c.exigeAcao).toBe(false);
    });

    it('dedução igual ao serviço zera a base', () => {
        const c = classificarIssZerado(nota({ valorDeducoes: 1000 }));
        expect(c.causa).toBe('deducao-integral');
        expect(c.exigeAcao).toBe(false);
    });

    it('alíquota ZERO na nota é isenção/imunidade, e carrega o código de serviço', () => {
        const c = classificarIssZerado(nota({ aliquotaServicos: 0, codigoServico: '05975' }));
        expect(c.causa).toBe('aliquota-zero');
        expect(c.exigeAcao).toBe(false);
        expect(c.codigoServico).toBe('05975');
    });

    it('alíquota AUSENTE não é alíquota zero — é buraco de captura, e PEDE ação', () => {
        const c = classificarIssZerado(nota({ aliquotaServicos: undefined }));
        expect(c.causa).toBe('aliquota-ausente');
        expect(c.exigeAcao).toBe(true);
        expect(c.texto).toMatch(/Ausente não é zero/);
    });

    it('nota que diz TRIBUTAR com ISS zero se contradiz — PEDE ação', () => {
        const c = classificarIssZerado(nota({ aliquotaServicos: 5 }));
        expect(c.causa).toBe('inconsistente');
        expect(c.exigeAcao).toBe(true);
    });

    it('nota sem valor de serviço não vira alarme de tributo', () => {
        expect(classificarIssZerado(nota({ valorServicos: 0 })).causa).toBe('sem-valor-servico');
    });

    it('lê a alíquota também na forma de OBJETO do XML', () => {
        const c = classificarIssZerado({ valores: { aliquota: 0 }, valorTotal: 500 });
        expect(c.causa).toBe('aliquota-zero');
    });
});

describe('resumo das causas de uma empresa', () => {
    it('a dominante é a que PEDE AÇÃO, mesmo sendo minoria', () => {
        // 40 notas de optante e 2 inconsistentes: quem precisa aparecer são as 2.
        const notas = [
            ...Array.from({ length: 40 }, () => nota({ prestadorOptanteSimples: true })),
            nota(), nota(),
        ];
        const r = resumirCausasIssZerado(notas);
        expect(r.total).toBe(42);
        expect(r.porCausa.optante).toBe(40);
        expect(r.dominante.causa).toBe('inconsistente');
        expect(r.exigemAcao).toBe(2);
        expect(r.explicado).toBe(false);
    });

    it('nenhuma causa pedindo ação ⇒ o zero está EXPLICADO', () => {
        const r = resumirCausasIssZerado([nota({ issRetido: true }), nota({ aliquotaServicos: 0 })]);
        expect(r.explicado).toBe(true);
        expect(r.exigemAcao).toBe(0);
        expect(r.dominante.causa).toMatch(/retido|aliquota-zero/);
    });

    it('sem nota nenhuma não inventa causa', () => {
        const r = resumirCausasIssZerado([]);
        expect(r.explicado).toBe(false);
        expect(r.dominante).toBeNull();
    });

    it('junta os códigos de serviço encontrados, sem repetir', () => {
        const r = resumirCausasIssZerado([
            nota({ aliquotaServicos: 0, codigoServico: '05975' }),
            nota({ aliquotaServicos: 0, codigoServico: '05975' }),
            nota({ aliquotaServicos: 0, codigoServico: '02496' }),
        ]);
        expect(r.codigosServico).toEqual(['02496', '05975']);
    });
});

/**
 * Regra permanente: cadastro diz X e a FONTE diz Y ⇒ ACENDE, não escolhe
 * sozinho. Aqui as duas respostas dão guias diferentes — optante recolhe o ISS
 * no DAS, não-optante recolhe em guia do município.
 */
describe('divergência entre o cadastro e a própria nota', () => {
    it('cadastro Lucro e nota dizendo OPTANTE acende — a guia cobrada seria indevida', () => {
        const d = divergenciaRegimePelaNota('lucro', [nota({ prestadorOptanteSimples: true })]);
        expect(d.divergente).toBe(true);
        expect(d.texto).toMatch(/guia cobrada aqui é indevida/);
    });

    it('cadastro Simples e nota dizendo NÃO optante acende — pode faltar guia', () => {
        const d = divergenciaRegimePelaNota('simples', [nota({ prestadorOptanteSimples: false })]);
        expect(d.divergente).toBe(true);
        expect(d.texto).toMatch(/não está cobrando/);
    });

    it('cadastro e nota de acordo não acendem nada', () => {
        expect(divergenciaRegimePelaNota('simples', [nota({ prestadorOptanteSimples: true })]).divergente).toBe(false);
        expect(divergenciaRegimePelaNota('lucro', [nota({ prestadorOptanteSimples: false })]).divergente).toBe(false);
    });

    it('campo AUSENTE na captura não afirma nada — silêncio não é prova', () => {
        expect(divergenciaRegimePelaNota('lucro', [nota()])).toBeNull();
        expect(divergenciaRegimePelaNota('lucro', [])).toBeNull();
    });

    it('notas dos dois jeitos não acendem: a divergência tem que ser limpa', () => {
        const d = divergenciaRegimePelaNota('lucro', [
            nota({ prestadorOptanteSimples: true }),
            nota({ prestadorOptanteSimples: false }),
        ]);
        expect(d.divergente).toBe(false);
    });
});
