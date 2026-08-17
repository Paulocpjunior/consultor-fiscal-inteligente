/**
 * 🔒 O selo de LGPD no rodapé — e o que ele pode afirmar.
 *
 * Paulo, 17/08: *"devemos atender a lei de proteção de dados LGPD, evidenciar
 * de forma enfática que estamos em acordo com a lei, sugiro isso no rodapé"*.
 *
 * 🚨 A TRAVA QUE ESTE ARQUIVO É: **selo sem mecanismo não pode existir**.
 *
 * Escrever "100% em conformidade com a LGPD" custa uma linha e vira uma
 * AFIRMAÇÃO ao titular — que, no dia em que alguém pedir os dados e não houver
 * como responder, deixa de ser marketing e passa a ser prova de informação
 * enganosa. É a régua do farol honesto: verde tem que significar alguma coisa.
 *
 * Então: se o rodapé fala de LGPD, os direitos do titular têm que existir no
 * código, e a página precisa dizer o que falta. Tirar o mecanismo e deixar a
 * frase derruba o build.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..');
const leia = (p: string) => readFileSync(join(raiz, p), 'utf8');

const rodapeCfi = leia('components/Footer.tsx');
const appTsx = leia('App.tsx');
const pagina = leia('public/privacidade.html');

describe('o selo aponta pra uma página que existe', () => {
    it('o rodapé do CFI e o do SP Connect levam à página de privacidade', () => {
        expect(rodapeCfi).toContain('/privacidade.html');
        expect(appTsx).toContain('/privacidade.html');
        expect(existsSync(join(raiz, 'public/privacidade.html'))).toBe(true);
    });

    it('o SP Connect também mostra a versão no rodapé — print sem versão é narrativa', () => {
        expect(appTsx).toMatch(/rotuloVersao\(\)/);
    });
});

describe('🚨 o que o rodapé afirma é o que o app SUSTENTA', () => {
    const frases = [rodapeCfi, appTsx].join('\n');

    it('não promete conformidade absoluta — "100%", "totalmente", "plenamente" não entram', () => {
        // A frase permitida é factual ("tratados conforme a LGPD, com finalidade
        // e base legal declaradas"); superlativo é promessa que ninguém audita.
        const trecho = frases.split('\n').filter((l) => /LGPD|13\.709/.test(l)).join(' ');
        expect(trecho).not.toMatch(/100%|totalmente em conformidade|plenamente|certificad/i);
    });

    it('cita a lei pelo número — "conforme a lei" sem dizer qual não informa nada', () => {
        expect(frases).toMatch(/13\.709/);
    });
});

describe('🚨 mecanismo antes da frase — os direitos do titular EXISTEM no código', () => {
    it('acesso, eliminação e registro da solicitação estão implementados', () => {
        const nucleo = leia('sefaz-backend/lgpd-titular.js');
        expect(nucleo).toMatch(/montarRelatorioTitular/);
        expect(nucleo).toMatch(/planoDeEliminacao/);
        expect(nucleo).toMatch(/registroDaSolicitacao/);
    });

    it('as rotas que atendem o titular existem — núcleo sem rota é promessa sem porta', () => {
        const rotas = leia('sefaz-backend/whatsapp-routes.js');
        expect(rotas).toMatch(/lgpd\/titular\/:numero/);
        expect(rotas).toMatch(/lgpd\/titular\/:numero\/eliminar/);
    });

    it('revogar consentimento bloqueia o envio — é o art. 18, IX valendo na prática', () => {
        expect(leia('sefaz-backend/whatsapp-etiquetas.js')).toMatch(/revogadoEm/);
    });
});

describe('🚨 a página é específica, não genérica', () => {
    it('diz a base legal POR tipo de dado (tabela), não "tratamos com segurança"', () => {
        expect(pagina).toMatch(/art\.\s*7º/);
        expect(pagina).toMatch(/[Cc]onsentimento/);
        expect(pagina).toMatch(/[Oo]brigação legal/);
    });

    it('diz o que a eliminação NÃO alcança, com o artigo — senão a promessa é enganosa', () => {
        expect(pagina).toMatch(/art\.\s*16/);
        expect(pagina).toMatch(/[Cc]omprovantes de envio/);
    });

    it('tem canal do titular — direito sem canal para exercer é direito no papel', () => {
        expect(pagina).toMatch(/@spassessoriacontabil\.com\.br/);
    });

    it('🚨 declara o que ainda está EM ANDAMENTO — selo que esconde pendência não protege ninguém', () => {
        // Diante da ANPD, informação enganosa é pior que informação incompleta.
        expect(pagina).toMatch(/em andamento/i);
        expect(pagina).toMatch(/[Ee]ncarregado|DPO/);
    });
});
