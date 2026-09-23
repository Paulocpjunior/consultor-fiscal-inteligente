// ============================================================================
// 🚨 "NFS-e nacional com erro" — 42/42 falhando, e a ação certa é o OPOSTO da
// intuitiva.
//
// 30/08, print do Paulo: o ADN em vermelho com *"TODAS as 42 tentativas da
// última execução falharam"* e dois motivos visíveis, os dois HTTP 400 com
// `E999 — Erro não catalogado`, cada um com o CNPJ de uma empresa diferente.
//
// O farol estava certo e a causa aparecia. **O que faltava era a AÇÃO** — e
// com 42 empresas em vermelho a reação natural é conferir cadastro e
// certificado das 42, uma a uma, à toa. É a lição das 236 empresas em ALTO
// (26/08): o custo não é a linha errada, é o dia perdido no lugar errado.
// ============================================================================
import {
    assinaturaDaFalha, deQuemEhAFalha, MIN_FALHAS_PARA_CULPAR_O_SERVICO,
} from '../services/falhaDeQuem';

const erroAdn = (cnpj: string) =>
    `${cnpj} — pagina 1: HTTP 400: {"StatusProcessamento":"REJEICAO","Alertas":[],`
    + `"Erros":[{"Mensagem":{},"Codigo":"E999","Descricao":"Erro não catalogado"}]}`;

describe('🚨 a assinatura ignora o que muda por empresa', () => {
    // ⚠️ SEM ISSO, duas falhas IDÊNTICAS contam como duas causas — é por isso
    // que o card mostrava "1× … 1× …" para o mesmo E999.
    it('duas empresas com o mesmo erro dão a MESMA assinatura', () => {
        const a = assinaturaDaFalha(erroAdn('27986638000108'));
        const b = assinaturaDaFalha(erroAdn('34025070000116'));
        expect(a).toBe(b);
        expect(a).toBe('HTTP 400 · E999');
    });

    it('erros diferentes dão assinaturas diferentes', () => {
        expect(assinaturaDaFalha('HTTP 400: E999')).not.toBe(assinaturaDaFalha('HTTP 500: E123'));
    });

    it('conhece o cStat da SEFAZ e o E2220 do ADN', () => {
        expect(assinaturaDaFalha('SEFAZ retornou cStat 656 (Consumo Indevido)')).toContain('656');
        expect(assinaturaDaFalha('HTTP 404: E2220 NENHUM_DOCUMENTO')).toBe('HTTP 404 · E2220');
    });

    it('sem código legível, cai no texto sem números', () => {
        expect(assinaturaDaFalha('timeout ao conectar em 30s')).toBe('timeout ao conectar em s');
        expect(assinaturaDaFalha('')).toBeNull();
    });
});

describe('🚨 de quem é a falha', () => {
    const motivosAdn = [
        { motivo: erroAdn('27986638000108'), quantidade: 1 },
        { motivo: erroAdn('34025070000116'), quantidade: 1 },
    ];

    it('o caso REAL: 0/42 com o mesmo E999 é do SERVIÇO', () => {
        const v = deQuemEhAFalha({ sucessos: 0, falhas: 42, motivos: motivosAdn, canal: 'NFS-e Nacional' });
        expect(v.origem).toBe('servico');
        expect(v.assinatura).toBe('HTTP 400 · E999');
        expect(v.frase).toContain('MESMO erro');
    });

    // 🚨 A AÇÃO É O QUE **NÃO** FAZER — é ela que evita as 42 conferências.
    it('e a ação manda NÃO conferir cadastro e NÃO reprocessar em série', () => {
        const v = deQuemEhAFalha({ sucessos: 0, falhas: 42, motivos: motivosAdn, canal: 'NFS-e Nacional' });
        expect(v.acao).toMatch(/Não confira cadastro/);
        expect(v.acao).toMatch(/não adianta reprocessar/i);
        expect(v.acao).toContain('E999');          // o código que se leva ao suporte
        expect(v.acao).toContain('NFS-e Nacional');
    });

    // ⚠️ COM SUCESSO JUNTO NUNCA É DO SERVIÇO: se algumas passaram, ele está de
    // pé, e o que falhou é daquelas empresas.
    it('havendo sucessos, a causa é de cada empresa', () => {
        const v = deQuemEhAFalha({ sucessos: 10, falhas: 3, motivos: motivosAdn });
        expect(v.origem).toBe('por-empresa');
        expect(v.acao).toMatch(/cadastro e o certificado das que falharam/);
    });

    // ⚠️ POUCAS FALHAS NÃO BASTAM: duas com o mesmo erro pode ser coincidência,
    // e afirmar "é do provedor" ali mandaria ignorar cadastro torto.
    it('abaixo do piso não culpa o serviço', () => {
        const v = deQuemEhAFalha({ sucessos: 0, falhas: MIN_FALHAS_PARA_CULPAR_O_SERVICO - 1, motivos: motivosAdn });
        expect(v.origem).toBe('por-empresa');
    });

    it('causas DIFERENTES continuam sendo de cada empresa', () => {
        const v = deQuemEhAFalha({
            sucessos: 0, falhas: 5,
            motivos: [
                { motivo: 'HTTP 400: E999', quantidade: 3 },
                { motivo: 'HTTP 403: certificado vencido', quantidade: 2 },
            ],
        });
        expect(v.origem).toBe('por-empresa');
        expect(v.frase).toContain('2 causa(s) diferentes');
    });

    it('sem falha nenhuma fica MUDO — não inventa veredito', () => {
        expect(deQuemEhAFalha({ sucessos: 10, falhas: 0, motivos: [] }).origem).toBe('indeterminado');
        expect(deQuemEhAFalha({}).frase).toBe('');
        expect(deQuemEhAFalha({ sucessos: 0, falhas: 42, motivos: [] }).origem).toBe('indeterminado');
    });

    // ⚠️ E ele NÃO diz QUAL é o defeito do provedor: "Erro não catalogado" é o
    // órgão dizendo que nem ele sabe, e deduzir dali seria inventar contrato.
    it('não afirma a causa técnica do provedor', () => {
        const v = deQuemEhAFalha({ sucessos: 0, falhas: 42, motivos: motivosAdn });
        expect(v.frase).not.toMatch(/contrato|API mudou|parâmetro/i);
    });
});
