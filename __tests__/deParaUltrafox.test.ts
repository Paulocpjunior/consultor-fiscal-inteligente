// ============================================================================
// O de-para Ultra Fox → SP Connect é o documento que responde "dá pra
// derrubar a Ultra Fox?". Documento vivo SEM TRAVA envelhece em silêncio —
// e aqui o custo é o pior possível: alguém lê "🔴 BLOQUEANTE: não abre
// mídia" depois de a mídia já abrir (e adia o corte à toa), ou o contrário,
// lê "coberto" numa lacuna que voltou.
//
// A trava é por COMPORTAMENTO, não por lista: o teste pergunta ao CÓDIGO se
// a capacidade existe e exige que o documento CONCORDE. É a mesma família
// do `reguaUnica` e do par HTML+md dos guias.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..');
const doc = readFileSync(join(raiz, 'docs/de-para-ultrafox-spconnect.md'), 'utf8');
const rotas = readFileSync(join(raiz, 'sefaz-backend/whatsapp-routes.js'), 'utf8');

/** A linha da tabela que fala de um assunto (busca pelo texto da 1ª coluna). */
function linhaDoDePara(assunto: string): string {
    const linha = doc.split('\n').find((l) => l.startsWith('|') && l.includes(assunto));
    expect(linha).toBeDefined();
    return linha!;
}

describe('estrutura do de-para', () => {
    it('toda linha da Ultra Fox declara a ORIGEM da evidência — de-para que finge saber faz cortar com buraco escondido', () => {
        expect(doc).toContain('**[print]**');
        expect(doc).toContain('**[Paulo]**');
        expect(doc).toContain('**[produção]**');
        expect(doc).toContain('**[?]**');
    });

    it('tem a seção de PERGUNTAS — o que não se sabe vira pergunta, nunca item preenchido por dedução', () => {
        expect(doc).toContain('PERGUNTAS AO PAULO');
        expect(doc).toContain('O que DECIDE o corte');
    });
});

describe('as lacunas bloqueantes CONCORDAM com o código', () => {
    // Mídia recebida: hoje o webhook baixa pro Storage, mas NENHUMA rota
    // serve o arquivo — o atendente vê o rótulo e não abre.
    it('se nascer rota que SERVE a mídia recebida, o de-para não pode continuar dizendo que não abre', () => {
        const serveMidia = /router\.get\([^)]*midia/.test(rotas);
        const linha = linhaDoDePara('Receber foto/documento/áudio e ABRIR');
        if (serveMidia) {
            expect(linha).not.toContain('🔴');   // lacuna fechada no código → atualize o de-para
        } else {
            expect(linha).toContain('🔴');
        }
    });

    // Envio de anexo pelo atendente: hoje só texto livre e template.
    it('se nascer rota de ENVIO de anexo, o de-para não pode continuar dizendo que não existe', () => {
        const enviaMidia = /router\.post\([^)]*(anexo|midia|arquivo)/.test(rotas);
        const linha = linhaDoDePara('Enviar anexo');
        if (enviaMidia) {
            expect(linha).not.toContain('🔴');
        } else {
            expect(linha).toContain('🔴');
        }
    });

    it('as três bloqueantes do corte estão nomeadas na seção de decisão', () => {
        const decisao = doc.slice(doc.indexOf('O que DECIDE o corte'));
        expect(decisao).toContain('mídia recebida');
        expect(decisao).toContain('anexo');
        expect(decisao).toContain('Notificação');
    });
});

describe('o que JÁ está coberto não pode aparecer como falta', () => {
    it('transferência, encerramento, papéis e avaliação estão no ar — e o de-para diz isso', () => {
        expect(rotas).toContain("router.post('/conversas/:numero/fila'");
        expect(linhaDoDePara('Transferir atendimento entre departamentos')).toContain('✅');
        expect(rotas).toContain("router.post('/conversas/:numero/situacao'");
        expect(linhaDoDePara('Encerrar atendimento')).toContain('✅');
        expect(rotas).toContain("router.post('/atendentes/:uid/papel'");
        expect(linhaDoDePara('Perfis de acesso')).toContain('✅');
        expect(rotas).toContain("router.get('/avaliacoes'");
        expect(linhaDoDePara('Avaliação do atendimento')).toContain('🆕');
    });

    it('o importador do backup existe — e é ele que precisa rodar ANTES de cancelar a plataforma', () => {
        expect(rotas).toContain("router.post('/importar-ultrafox'");
        expect(linhaDoDePara('Restaurar o backup da Ultra Fox')).toContain('✅');
        expect(doc).toContain('plataforma cancelada não devolve export');
    });
});

// ============================================================================
// 🚨 O QUE O SP CONNECT PASSOU A FAZER TAMBÉM ENVELHECE O DOCUMENTO
//
// A trava original vigiava as LACUNAS (o app ganhou a capacidade → o de-para
// não pode mais dizer 🔴). Faltava a direção contrária, e ela mordeu: a IA de
// triagem subiu em 25/08, virou a primeira coisa que o cliente encontra, e o
// de-para não tinha uma linha sobre ela — nem o manual da equipe. Quem lesse
// os dois para decidir o corte não saberia que o bot mudou de comportamento.
//
// A régua é a mesma: pergunta ao CÓDIGO, exige que o documento concorde.
// ============================================================================
describe('🚨 capacidade NOVA do bot obriga linha no de-para', () => {
    const atendimento = readFileSync(join(raiz, 'sefaz-backend/whatsapp-atendimento.js'), 'utf8');
    const sobre = readFileSync(join(raiz, 'services/sobreConnect.ts'), 'utf8');

    it('a IA de triagem existe no código — então ela está no de-para', () => {
        expect(atendimento).toMatch(/triagemIaAtiva/);
        expect(doc).toMatch(/texto livre/i);
        // E o que ela NÃO faz vale tanto quanto: é isso que sustenta a decisão
        // de deixá-la ligada por padrão.
        expect(doc).toMatch(/não responde ao cliente/);
    });

    it('🚨 e ela está no MANUAL DA EQUIPE — manual errado é pior que manual nenhum', () => {
        // Quem não sabe segue o que está escrito: um manual que só descreve o
        // menu numérico deixa o colaborador sem entender por que a conversa
        // chegou na fila dele sem o cliente ter digitado nada.
        expect(sobre).toMatch(/#menu/);
        expect(sobre).toMatch(/IA/);
        expect(sobre).toMatch(/nota interna|NOTA INTERNA/i);
    });

    it('o encerrar que SOLTA a conversa está declarado', () => {
        expect(atendimento).toMatch(/liberarConducao/);
        expect(doc).toMatch(/Encerrar SOLTA a conversa/);
    });

    it('a presença saiu do 🟡 — ela está no ar desde 26/08', () => {
        const linha = linhaDoDePara('Presença (online/ausente)');
        expect(linha).not.toMatch(/🟡/);
        // E o documento repete a ressalva que a tela faz: o app mede o SINAL,
        // não a pessoa. Sem isso alguém leria "presença" como ponto eletrônico.
        expect(linha).toMatch(/nunca "offline"/);
    });
});
