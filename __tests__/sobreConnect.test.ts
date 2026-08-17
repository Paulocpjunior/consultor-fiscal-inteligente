/**
 * ℹ️ SOBRE do SP Connect — manual, histórico e selo.
 *
 * O que este teste existe pra impedir são as DUAS formas de o SOBRE
 * envelhecer em silêncio, que é o pior jeito de envelhecer:
 *
 *  (1) **Selo mentiroso** — versão nova sem texto novo (o selo vermelho
 *      promete leitura que não está lá), ou texto novo sem versão nova (a
 *      equipe nunca fica sabendo). É EXATAMENTE o que aconteceu com o 📣
 *      Novidades do CFI: onze dias de entrega com o selo apagado, porque a
 *      regra do par estava escrita e não tinha trava (Paulo, 15/08).
 *
 *  (2) **Manual que não acompanha o app** — comando novo do bot, botão novo
 *      na tela, e o manual seguindo igual. Manual errado é pior que manual
 *      nenhum: quem não sabe segue o que está escrito.
 *
 * A trava do (2) é por COMPORTAMENTO — varre quem DECIDE o comando no núcleo
 * do bot —, nunca por lista de comandos copiada aqui: lista envelhece no
 * primeiro comando novo, e envelhece calada.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    SOBRE_VERSAO, REVISOES, MANUAL, O_QUE_FAZ, DIFERENCIAIS, POR_QUE,
    revisaoMaisNova, temSobreNaoLido, marcarSobreComoLido, dataBr,
} from '../services/sobreConnect';

const raiz = join(__dirname, '..');
const leia = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('o par versão × histórico', () => {
    it('a versão é a data da revisão MAIS NOVA — nem selo sem texto, nem texto sem selo', () => {
        expect(revisaoMaisNova()).toBeTruthy();
        expect(SOBRE_VERSAO).toBe(revisaoMaisNova()!.data);
    });

    it('toda revisão tem data AAAA-MM-DD e pelo menos um item', () => {
        expect(REVISOES.length).toBeGreaterThan(0);
        REVISOES.forEach((r) => {
            expect(r.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(r.itens.length).toBeGreaterThan(0);
            r.itens.forEach((i) => expect(i.trim().length).toBeGreaterThan(10));
        });
    });

    it('o histórico vem da mais NOVA pra mais velha (é assim que se lê novidade)', () => {
        const datas = REVISOES.map((r) => r.data);
        expect([...datas].sort().reverse()).toEqual(datas);
    });

    it('dataBr traduz pro formato que a equipe lê', () => {
        expect(dataBr('2026-08-16')).toBe('16/08/2026');
        expect(dataBr('vazio')).toBe('vazio');   // não inventa data
    });
});

describe('o selo só apaga quando ALGUÉM ABRE', () => {
    beforeEach(() => localStorage.clear());

    it('quem nunca abriu vê o selo', () => {
        expect(temSobreNaoLido()).toBe(true);
    });

    it('abrir carimba, e o selo apaga', () => {
        marcarSobreComoLido();
        expect(temSobreNaoLido()).toBe(false);
    });

    it('revisão NOVA reacende o selo sozinha, mesmo pra quem já tinha lido', () => {
        marcarSobreComoLido();
        expect(temSobreNaoLido('2026-09-01')).toBe(true);
    });

    it('a régua de comparação é IMPORTADA, não copiada — selo com duas réguas diverge', () => {
        const fonte = leia('services/sobreConnect.ts');
        expect(fonte).toMatch(/import\s*{[^}]*temNovidadeNaoLida[^}]*}\s*from\s*'\.\/novidadesService'/);
        // A comparação em si (o `!==` entre versão vista e atual) não pode
        // reaparecer aqui: é o que o novidadesService responde.
        expect(fonte).not.toMatch(/versaoVista\s*(!==|===)/);
    });
});

describe('🚨 o manual acompanha o que o app REALMENTE faz', () => {
    const textoManual = JSON.stringify(MANUAL);

    it('todo comando que o BOT reconhece está ensinado no manual', () => {
        // Varre quem DECIDE o comando (o núcleo do bot), não uma lista copiada:
        // comando novo lá dentro obriga manual novo aqui, no mesmo PR.
        const nucleo = leia('sefaz-backend/whatsapp-atendimento.js');
        const comandos = [...nucleo.matchAll(/\/\^#\?(\w+)\$\/i/g)].map((m) => m[1]);
        expect(comandos.length).toBeGreaterThanOrEqual(2);   // hoje: sair e menu
        comandos.forEach((c) => {
            expect(textoManual).toContain(`#${c}`);
        });
    });

    it('o manual explica a janela de 24h — é a regra que mais confunde quem atende', () => {
        expect(textoManual).toMatch(/24h/);
        expect(textoManual).toMatch(/template/i);
    });

    it('o manual diz QUEM pode encerrar (a trava que o colaborador encontra na tela)', () => {
        expect(textoManual).toMatch(/gestor/i);
        expect(textoManual).toMatch(/[Aa]ssuma|[Aa]ssumir/);
    });

    // 🚨 A ESCALA DA AVALIAÇÃO É CONFIGURÁVEL — e o manual dizia "1 a 5"
    // depois de ela virar 10. O texto que ensina o colaborador não pode cravar
    // um número que mora na ⚙️: quando o Paulo mudar a escala de novo, ninguém
    // vai lembrar de caçar a frase, e manual errado é pior que manual nenhum.
    // A frase certa manda para a ⚙️, que é onde a resposta de verdade está.
    it('o manual NÃO crava a escala da nota — ela é dado da ⚙️, não texto', () => {
        const cravado = /(nota|avalia\w*)[^.]{0,60}\b1\s*(?:a|-|até)\s*(?:5|10)\b/i;
        // A revisão do histórico PODE citar a mudança de escala (é o registro
        // do que aconteceu naquele dia); o que não pode é o manual ENSINAR
        // um número que a ⚙️ pode desmentir amanhã.
        expect(cravado.test(textoManual)).toBe(false);
        expect(JSON.stringify(O_QUE_FAZ)).not.toMatch(cravado);
        expect(textoManual).toMatch(/⚙️/);
    });

    it('todo passo tem título e pelo menos um passo de verdade', () => {
        expect(MANUAL.length).toBeGreaterThanOrEqual(5);
        MANUAL.forEach((s) => {
            expect(s.titulo.trim().length).toBeGreaterThan(3);
            expect(s.passos.length).toBeGreaterThan(0);
            s.passos.forEach((p) => expect(p.trim().length).toBeGreaterThan(10));
        });
    });
});

describe('o SOBRE responde às cinco coisas que o Paulo pediu', () => {
    it('manual, histórico, o que faz, por quê e diferenciais — nenhum vazio', () => {
        expect(MANUAL.length).toBeGreaterThan(0);
        expect(REVISOES.length).toBeGreaterThan(0);
        expect(O_QUE_FAZ.length).toBeGreaterThan(0);
        expect(POR_QUE.trim().length).toBeGreaterThan(200);
        expect(DIFERENCIAIS.length).toBeGreaterThan(0);
    });

    it('os blocos têm título e texto (card sem texto é enfeite)', () => {
        [...O_QUE_FAZ, ...DIFERENCIAIS].forEach((b) => {
            expect(b.titulo.trim().length).toBeGreaterThan(3);
            expect(b.texto.trim().length).toBeGreaterThan(30);
        });
    });
});

describe('🚨 conteúdo sem BOTÃO não é entrega', () => {
    // Mesma família do rito de fechamento que subiu sem tela e do E510 "pronto"
    // que ninguém gerava: rota/tela nova nasce com o caminho que a chama.
    const tela = leia('components/SpConnect/index.tsx');

    it('o SP Connect tem o botão que abre o SOBRE', () => {
        expect(tela).toMatch(/abrirSobre/);
        expect(tela).toMatch(/sobreConnect/);
    });

    it('abrir o SOBRE é o que carimba a leitura — selo que apaga sozinho seria mentira', () => {
        expect(tela).toMatch(/marcarSobreComoLido/);
    });

    it('o guia de instalação tem caminho NA TELA — guia que ninguém acha é texto órfão', () => {
        // Ele responde "como coloco isso no Teams / no celular?", e a resposta
        // não pode viver só num arquivo do repositório.
        expect(tela).toContain('/guia-instalar-sp-connect.html');
        expect(existsSync(join(raiz, 'public/guia-instalar-sp-connect.html'))).toBe(true);
    });
});
