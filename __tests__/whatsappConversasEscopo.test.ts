// ============================================================================
// 🔒 Escopo por fila de PONTA A PONTA (Paulo, 24/08: "usuários que estão
// somente dentro de um grupo só têm acesso àquele grupo específico… e quanto
// ao total de mensagens também, assim ganhamos mais tempo ao carregar")
// ----------------------------------------------------------------------------
// Três metades que têm que andar juntas:
//  · a LEITURA corta no servidor (where fila in) — antes o backend varria as
//    2000 conversas mais recentes da carteira pra depois jogar fora o que o
//    colaborador não vê;
//  · a lista vazia de filas NÃO vira consulta (o Firestore recusa `in` []);
//  · o ✚ Nova conversa oferece SÓ as filas dele (iniciar por outra fila
//    criaria atendimento que ele mesmo não veria depois).
// A régua de QUEM vê o quê continua uma só (filasVisiveis/conversaVisivel,
// provadas em whatsappAtendimento.test.ts e whatsappPush.test.ts).
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('GET /conversas lê só as filas do usuário', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');

    it('a consulta é filtrada por fila no SERVIDOR quando há restrição', () => {
        expect(rotas).toMatch(/where\('fila', 'in', minhasFilas\)/);
    });

    it('sem fila vinculada não consulta (o Firestore recusa `in` vazio)', () => {
        expect(rotas).toMatch(/minhasFilas\.length\s*\n?\s*\?/);
    });

    it('o filtro de visibilidade em memória CONTINUA (cinto e suspensório)', () => {
        expect(rotas).toMatch(/conversaVisivel\(minhasFilas, cv\.fila\)/);
    });
});

describe('✚ Nova conversa respeita as filas do usuário', () => {
    const tela = ler('components/SpConnect/index.tsx');

    it('o select de departamento usa filasChip (as filas DELE), não o catálogo', () => {
        expect(tela).toMatch(/filasChip\.map\(\(f\) => <option/);
    });

    it('o default do departamento se ajusta às filas visíveis ao abrir', () => {
        expect(tela).toMatch(/filasChip\.some\(\(x\) => x\.id === f\.departamento\)/);
    });
});

// ═══ 24/08 — "é um organograma" ════════════════════════════════════════════
// Paulo: "dpto. Legalização tinha somente o Jefferson, agora ele e os demais;
// os históricos têm que ser visualizados por DEPARTAMENTO."
//
// O histórico já é do DEPARTAMENTO (a conversa mora na fila, e quem tem a
// fila vê tudo o que já aconteceu nela — inclusive o que outra pessoa
// respondeu antes). O que faltava era a ponta oposta: o escopo por fila que
// entrou hoje olhava SÓ a fila, então a conversa ATRIBUÍDA a alguém e ainda
// parada na Recepção sumia da vista DELE PRÓPRIO — exatamente o caso de quem
// atendia sozinho antes de o departamento crescer.
describe('a conversa que EU conduzo é sempre minha de ver', () => {
    const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    it('podeVerConversa libera o que está em condução por mim, sem olhar a fila', () => {
        const trecho = rotas.slice(rotas.indexOf('async function podeVerConversa'));
        expect(trecho.slice(0, 900)).toMatch(/minha \|\| conversaVisivel\(filas, dados\.fila \|\| null\)/);
    });

    it('a LISTA soma as filas dele + o que está atribuído a ele (sem duplicar)', () => {
        expect(rotas).toMatch(/where\('atribuidoA', '==', req\.user\.email\)/);
        expect(rotas).toMatch(/if \(vistos\.has\(d\.id\)\) return false;/);
    });

    it('e o filtro em memória concorda com a consulta', () => {
        expect(rotas).toMatch(/\|\| \(req\.user\?\.email && cv\.atribuidoA === req\.user\.email\)/);
    });
});

// ═══ 24/08 — "as conversas estão fora de ordem" ════════════════════════════
// A lista ORDENAVA por `atualizadoEm` (qualquer atividade, inclusive as que
// não viram linha na conversa: assumir, vincular cliente, mudar situação) e
// EXIBIA o horário da última MENSAGEM. Conversa que só teve ação interna
// subia ao topo mostrando um horário velho — e a lista parecia embaralhada.
// Duas leituras do mesmo fato na MESMA linha.
describe('a lista ordena pelo que ela mostra', () => {
    const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

    it('a ordenação usa ultimaMensagem.em com atualizadoEm de reserva', () => {
        expect(rotas).toMatch(/cv\.ultimaMensagem\?\.em \|\| cv\.atualizadoEm/);
        expect(rotas).toMatch(/quandoExibido\(b\) - quandoExibido\(a\)/);
    });

    it('e é EXATAMENTE o campo que a tela imprime na linha', () => {
        expect(tela).toMatch(/horaCurta\(c\.ultimaMensagem\?\.em \|\| c\.atualizadoEm, agora\)/);
    });
});
