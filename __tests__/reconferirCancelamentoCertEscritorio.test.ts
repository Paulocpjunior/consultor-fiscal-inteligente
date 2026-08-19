/**
 * A rota /reconferir-cancelamento ganhou um SEGUNDO caminho quando a empresa
 * não tem A1 próprio/da raiz (caso MV LIDER 639, cert A3): cai no certificado
 * do ESCRITÓRIO, consultando COMO escritório — o MESMO caminho que a tela
 * "Consultar NFe por chave" já usa em produção.
 *
 * Paulo provou nas 3 chaves suspeitas da MV LIDER, 18/08: a SEFAZ responde
 * cStat=653 (NF-e Cancelada) mesmo sem o escritório ser parte do documento —
 * então não precisa de um SEGUNDO webservice (a Consulta Situação, que ainda
 * não tinha sido provada); o `consultaNFePorChave` que já roda em produção
 * resolve, só trocando QUEM está perguntando.
 *
 * O corpo da rota mistura Express + Firestore real (`fa().firestore()`), o
 * que torna mock completo caro pra pouco ganho — a régua da casa aqui é
 * varredura de FONTE, como em `reconferirRebuscaAutomatica.test.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(
    path.resolve(__dirname, '../sefaz-backend/conferencia-chaves-routes.js'), 'utf8',
);

describe('reconferir-cancelamento — sem A1 próprio cai no cert do escritório', () => {
    it('importa CNPJ_ESCRITORIO de empresa-flags.js — nunca uma cópia local', () => {
        expect(src).toMatch(/import \{ carregarFlagsEmpresa, CNPJ_ESCRITORIO \} from '\.\/empresa-flags\.js';/);
    });

    it('nunca mais recusa de cara por falta de A1 — sempre pergunta de algum jeito', () => {
        expect(src).not.toContain('Empresa sem certificado A1 próprio ou da mesma raiz — a consulta por chave exige o');
        expect(src).toMatch(/const usaCertEscritorio = !cert;/);
    });

    it('sem cert próprio, consulta COMO escritório — cnpjInteressado muda, não só o certOverride', () => {
        const inicioLoop = src.indexOf('for (const alvo of selecao.aConsultar)');
        const corpo = src.slice(inicioLoop, inicioLoop + 700);
        expect(corpo).toMatch(/cnpjInteressado: usaCertEscritorio \? CNPJ_ESCRITORIO : cnpjEmpresa/);
        expect(corpo).toMatch(/certOverride: usaCertEscritorio \? null : cert/);
        // Continua lendo pela MESMA função — nunca uma segunda cópia da régua
        // de leitura só porque o caminho de certificado mudou.
        expect(corpo).toContain('lerRespostaCancelamento(r)');
    });

    it('a gravação do cancelamento carimba a ORIGEM diferente quando veio do cert do escritório', () => {
        expect(src).toContain("usaCertEscritorio ? 'reconferencia-sefaz-cert-escritorio' : 'reconferencia-sefaz'");
    });

    it('o resumo recebe o modo — pra avisar o colaborador qual caminho foi usado', () => {
        expect(src).toMatch(/modo: usaCertEscritorio \? 'cert-escritorio' : 'distdfe'/);
    });
});
