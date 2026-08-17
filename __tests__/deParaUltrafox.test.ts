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
