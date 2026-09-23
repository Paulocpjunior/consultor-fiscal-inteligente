// ============================================================================
// 🚨 "879 ERROS" — E A MAIORIA NÃO ERA ERRO
//
// 02/09, print do Paulo depois de clicar "Executar Sync Agora". A conta foi
// MEDIDA no código, não deduzida: 4 chamadas ao proxy por empresa (2
// competências × 2 direções) × 416 empresas = **1.664 chamadas**, contra um
// teto de **60 por minuto** publicado pelo próprio proxy.
//
// O resto é 404 ESPERADO: o auto-sync **LÊ** o SharePoint e nunca cria pasta —
// quem cria é o upload. A árvore do `Departamento Fiscal` ainda não existe em
// empresa nenhuma, então listar aquela pasta responde 404, que é a verdade.
//
// ⚠️ Um contador só faz as três coisas parecerem o mesmo problema, e as ações
// são OPOSTAS: 404 não pede nada de ninguém; 429 é o app batendo rápido
// demais; credencial recusada trava a carteira e é do administrador.
// ============================================================================
// @ts-expect-error — módulo .js puro
import { classificarErroDeLeitura, resumoDaRodada, intervaloEntreChamadasMs } from '../sefaz-backend/sharepoint-erro-leitura.js';

describe('classificarErroDeLeitura', () => {
    // A mensagem REAL do print de 02/09.
    const ERRO_404 = 'Failed to list folder (404) em spassessoriacontabilcombr.sharepoint.com'
        + '/sites/ClientesSP2 → "Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Setembro/XML SAÍDA"';

    it('404 de leitura NÃO é erro — a competência ainda não existe lá', () => {
        const r = classificarErroDeLeitura(ERRO_404);
        expect(r.causa).toBe('pasta-inexistente');
        expect(r.ehErro).toBe(false);
    });

    it('429 é o limite do NOSSO proxy, não problema da empresa da linha', () => {
        const r = classificarErroDeLeitura('Muitas requisições. Aguarde um momento.');
        expect(r.causa).toBe('limite-do-proxy');
        expect(r.ehErro).toBe(true);
        expect(r.acao).toMatch(/Não é problema desta empresa/);
    });

    it('credencial recusada trava a carteira inteira e diz isso', () => {
        const r = classificarErroDeLeitura('Azure AD token error (401): AADSTS7000215');
        expect(r.causa).toBe('credencial');
        expect(r.acao).toMatch(/NENHUMA empresa sincroniza/);
    });

    // ⚠️ `desconhecido` NÃO é aprovação: continua contando como erro, com a
    // mensagem inteira — afirmar a causa errada manda procurar no lugar errado.
    it('o que não se reconhece continua sendo erro, sem causa inventada', () => {
        const r = classificarErroDeLeitura('socket hang up');
        expect(r.causa).toBe('desconhecido');
        expect(r.ehErro).toBe(true);
        expect(r.acao).toBeNull();
    });
});

describe('resumoDaRodada — causa junto do número', () => {
    it('a rodada de 02/09 deixa de dizer "879 erros" sobre situação normal', () => {
        const s = resumoDaRodada({ novos: 0, duplicados: 0, erros: 4, semPasta: 860, limite: 15 });
        expect(s).toMatch(/860 pasta\(s\) ainda sem a competência/);
        expect(s).toMatch(/15 recusa\(s\) por limite do proxy/);
    });

    // ⚠️ Rodada limpa não ganha ruído: alarme sobre arquivo correto é o jeito
    // conhecido de a equipe desligar o farol.
    it('rodada sem pendência não inventa frase', () => {
        expect(resumoDaRodada({ novos: 3, duplicados: 1, erros: 0 }))
            .toBe('3 novos · 1 duplicados · 0 erros');
    });
});

describe('intervaloEntreChamadasMs — o respiro do proxy', () => {
    it('60 por minuto vira um respiro de 1s', () => {
        expect(intervaloEntreChamadasMs(60)).toBe(1000);
    });

    // ⚠️ Sem teto conhecido não se inventa pausa: atrasar a rodada por dedução
    // minha seria o oposto de medir.
    it('teto ausente ou inválido não vira pausa inventada', () => {
        expect(intervaloEntreChamadasMs(0)).toBe(0);
        expect(intervaloEntreChamadasMs(undefined)).toBe(0);
        expect(intervaloEntreChamadasMs('abc')).toBe(0);
    });
});
