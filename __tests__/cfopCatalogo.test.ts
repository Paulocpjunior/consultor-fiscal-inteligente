// ============================================================================
// 🚨 A BASE DE CONSULTA DE CFOP ESTAVA DESATUALIZADA — e o app citava a oficial.
//
// Paulo, 17/08: *"a nossa base de consulta está desatualizada, mas veja uma
// incongruência: o próprio CFI publica o link do CONFAZ com todos os CFOPs
// atualizados, inclusive o 1556, que se trata de compra de material para
// uso/consumo"*.
//
// Ele estava certo — o app apontava para a tabela oficial e tinha DUAS
// descrições gravadas, dentro do geminiService.
//
// ═══ O CASO KALUNGA, QUE MOSTRA POR QUE ISSO IMPORTA ════════════════════════
//
// Ainda dele: *"uma indústria compra da Kalunga material de escritório. A
// indústria não usa essa nota para industrialização nem comercialização — ela
// usa para uso/consumo ou compra de ativo"*.
//
// A régua automática escreve 1101 para toda compra de indústria. O XML NÃO diz
// o destino (a Kalunga emite 5102 porque para ELA é revenda), então o app não
// tem como saber — a correção é o campo por NF. O que a tela pode fazer é
// mostrar a DESCRIÇÃO do que ela escreveu, para o erro ficar óbvio antes de
// virar livro.
//
// REGRA QUE FICA: descrição entra COPIADA da tabela oficial, nunca de memória.
// Descrição errada é pior que descrição nenhuma — ela faz escolher com
// confiança o CFOP errado.
// ============================================================================
import { descricaoCfop, textoDoCfop, FONTE_CFOP, tamanhoDoCatalogo } from '../sefaz-backend/cfop-catalogo.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('o catálogo não inventa descrição', () => {
    it('código que ele conhece devolve a descrição oficial', () => {
        expect(descricaoCfop('5106')).toMatch(/Venda de mercadoria adquirida ou recebida de terceiros/);
    });

    it('🚨 código que ele NÃO conhece devolve null — não uma frase genérica', () => {
        // Null é de propósito: quem chama precisa distinguir "não temos" de
        // "a descrição é esta". Frase genérica faria a tela parecer completa.
        expect(descricaoCfop('1556')).toBeNull();
        expect(descricaoCfop('1101')).toBeNull();
    });

    it('CFOP inválido não vira descrição', () => {
        expect(descricaoCfop('110')).toBeNull();
        expect(descricaoCfop('')).toBeNull();
    });

    it('máscara com ponto é aceita — quem lê o livro vê 1.102', () => {
        expect(descricaoCfop('5.106')).toBe(descricaoCfop('5106'));
    });
});

describe('a lacuna é NOMEADA, com a fonte do lado', () => {
    it('sem descrição, o texto diz que falta e manda conferir', () => {
        const t = textoDoCfop('1556');
        expect(t.temDescricao).toBe(false);
        expect(t.texto).toMatch(/ainda não cadastrada no CFI/);
        expect(t.fonte?.url).toBe(FONTE_CFOP.url);
    });

    it('com descrição, a fonte continua junto', () => {
        const t = textoDoCfop('5106');
        expect(t.temDescricao).toBe(true);
        expect(t.fonte?.url).toContain('confaz.fazenda.gov.br');
    });

    it('o tamanho do catálogo é visível — é o número que denuncia a lacuna', () => {
        expect(tamanhoDoCatalogo()).toBe(Object.keys({ '1924': 1, '5106': 1 }).length);
    });
});

describe('🚨 a tabela mora num lugar só', () => {
    it('o geminiService LÊ do catálogo — não tem cópia própria', () => {
        const f = readFileSync(join(__dirname, '..', 'services/geminiService.ts'), 'utf8');
        expect(f).toMatch(/import \{ descricaoCfop, FONTE_CFOP \} from '\.\.\/sefaz-backend\/cfop-catalogo\.js'/);
        expect(f).not.toMatch(/const CFOP_DESCRICOES/);
        // E a URL oficial não pode voltar a ser escrita à mão aqui.
        expect(f).not.toMatch(/copy_of_cfop_cvsn_70_nova/);
    });

    it('a tela do CFOP por nota mostra a descrição junto do número', () => {
        const f = readFileSync(join(__dirname, '..', 'components/Relatorios/index.tsx'), 'utf8');
        expect(f).toMatch(/import \{ textoDoCfop, FONTE_CFOP \}/);
        expect(f).toMatch(/O que esse CFOP é/);
    });
});
