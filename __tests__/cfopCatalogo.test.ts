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

    it('🚨 código que NÃO CONSTA da tabela devolve null — não uma frase genérica', () => {
        // Com o catálogo COMPLETO, null deixa de significar "falta cadastrar" e
        // passa a significar "este CFOP NÃO EXISTE" — que é o alarme que revelou
        // o 1405 e o 1655.
        expect(descricaoCfop('1405')).toBeNull();
        expect(descricaoCfop('1655')).toBeNull();
        // E os que existem respondem, incluindo os que o Paulo citou.
        expect(descricaoCfop('1556')).toBe('Compra de material para uso ou consumo');
        expect(descricaoCfop('1551')).toBe('Compra de bem para o ativo imobilizado');
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
    it('sem descrição, o texto diz que NÃO CONSTA e manda conferir', () => {
        const t = textoDoCfop('1655');
        expect(t.temDescricao).toBe(false);
        expect(t.texto).toMatch(/NAO CONSTA na tabela em vigor/);
        expect(t.fonte?.url).toBe(FONTE_CFOP.url);
    });

    it('com descrição, a fonte continua junto', () => {
        const t = textoDoCfop('5106');
        expect(t.temDescricao).toBe(true);
        expect(t.fonte?.url).toContain('confaz.fazenda.gov.br');
    });

    it('o catálogo está CARREGADO — não é mais um punhado de códigos', () => {
        expect(tamanhoDoCatalogo()).toBeGreaterThan(600);
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
        expect(f).toMatch(/import \{ textoDoCfop, FONTE_CFOP, cfopsInexistentes \}/);
        expect(f).toMatch(/O que esse CFOP é/);
        // E a conferência contra a NORMA aparece resumida, não só linha a linha:
        // ninguém varre 256 linhas atrás do CFOP que não existe.
        expect(f).toMatch(/NÃO CONSTA da tabela em vigor/);
    });
});

// ============================================================================
// 🚨 A TABELA QUE O CONFAZ PUBLICA EM "cfop_cvsn_70_nova" NÃO É A EM VIGOR.
//
// Paulo mandou o PDF dessa página em 17/08 para preencher o catálogo. Ao ler o
// arquivo ANTES de carregar, ele se desmente no próprio cabeçalho ("Nova redação
// dada ao CFOP pelo Ajuste SINIEF 16/20, SEM EFEITOS" · "Revogado, a partir de
// 01.06.22, pelo Ajuste SINIEF 03/22") — e a prova prática é maior: aquela
// redação ELIMINA A FAMÍLIA ST INTEIRA (a faixa 1.4xx fica só com 1450-1456).
//
// O CFI escritura 1403 HOJE — ele está no Resumo por CFOP da NOVA ERA 07/2026
// com 56 notas. Carregar aquela tabela faria o app dizer "não cadastrado" para
// um código que ele mesmo produz.
//
// ESTA É A TRAVA: se um dia o catálogo for carregado, a família ST tem que estar
// nele. Catálogo sem ela é a redação errada.
// ============================================================================
describe('🚨 catálogo carregado tem que ter a família ST', () => {
    const ST_OBRIGATORIOS = ['1401', '1403', '1406', '1407', '1408', '1409', '1410', '1411'];

    it('o catálogo carregado conhece a família ST — senão é a redação errada', () => {
        const faltando = ST_OBRIGATORIOS.filter((c) => !descricaoCfop(c));
        expect({ faltando, dica: faltando.length ? 'é a redação do Ajuste SINIEF 16/20, que está SEM EFEITOS' : '' })
            .toEqual({ faltando: [], dica: '' });
    });

    it('e a régua produz esses códigos — por isso eles não podem faltar', () => {
        const { correlacionarCfop } = require('../sefaz-backend/cfop-correlacao.js');
        expect(correlacionarCfop('5405', 'entrada', { naturezaAtividade: 'comercio' })).toBe('1403');
        expect(correlacionarCfop('5410', 'entrada', { naturezaAtividade: 'comercio' })).toBe('1411');
    });
});

// ============================================================================
// 🚨 A TRAVA MAIS FORTE: A RÉGUA NÃO PODE PRODUZIR CFOP QUE NÃO EXISTE.
//
// Foi assim que o 1405 nasceu (05/08) e foi assim que o 1655 apareceu com 109
// notas no Resumo por CFOP da NOVA ERA 07/2026: a conversão mecânica preserva o
// sufixo do vendedor, e em várias famílias aquele sufixo NÃO TEM PAR na entrada.
//
// Esta varredura roda a régua sobre as famílias que ela TRANSFORMA e exige que o
// resultado conste da tabela oficial.
//
// ⚠️ Ela NÃO varre a tabela inteira de propósito: muitos CFOPs de saída não têm
// (nem precisam de) par na entrada — uma varredura total acusaria 66 códigos e
// viraria alarme sem ação, que é teste desligado. O que a régua TOCA, ela tem
// que acertar; o resto continua saindo pela conversão mecânica e aparece na
// conferência da tela quando de fato acontecer num documento.
// ============================================================================
describe('🚨 a régua não inventa CFOP nas famílias que ela transforma', () => {
    const { correlacionarCfop } = require('../sefaz-backend/cfop-correlacao.js');
    const { cfopExiste } = require('../sefaz-backend/cfop-catalogo.js');
    const FAMILIAS = [
        '101', '102', '116', '117', '118', '120', '122',          // compra
        '151', '152', '154',                                       // transferência
        '201', '202', '208', '209',                                // devolução
        '401', '402', '403', '404', '405', '410', '411',           // ST
        '651', '652', '653', '654', '655', '656',                  // combustível
    ];
    const NATUREZAS = ['comercio', 'industria', 'servicos', 'misto', undefined];

    it('todo resultado consta da tabela em vigor', () => {
        // ⚠️ A ENTRADA DA VARREDURA SÃO OS CFOPs DE SAÍDA QUE EXISTEM DE VERDADE.
        //
        // A primeira versão montava os códigos combinando faixa × sufixo, e
        // acusou 37 falhas — todas na faixa 3 (importação), para códigos como
        // "7151" que NÃO EXISTEM nem como saída. O app só converte CFOP que veio
        // num XML, e XML carrega código real: alimentar a régua com código
        // inventado é acusar defeito onde não há, e teste que grita sem motivo é
        // teste desligado.
        const { CFOP_DESCRICOES } = require('../sefaz-backend/cfop-catalogo.js');
        const saidasReais = Object.keys(CFOP_DESCRICOES)
            .filter((k: string) => ['5', '6', '7'].includes(k[0]) && FAMILIAS.includes(k.slice(1)));
        expect(saidasReais.length).toBeGreaterThan(40);

        const ruins: string[] = [];
        for (const cfop of saidasReais) {
            for (const nat of NATUREZAS) {
                const r = correlacionarCfop(cfop, 'entrada', { naturezaAtividade: nat });
                if (!cfopExiste(r)) ruins.push(`${cfop}/${nat || '-'} -> ${r}`);
            }
        }
        expect(ruins).toEqual([]);
    });

    it('e o 1655 do print da NOVA ERA não volta: 5655 vira 1652', () => {
        expect(correlacionarCfop('5655', 'entrada', { naturezaAtividade: 'comercio' })).toBe('1652');
        expect(cfopExiste('1655')).toBe(false);
    });

    it('nem o 1405: 5405 vira 1403', () => {
        expect(correlacionarCfop('5405', 'entrada', { naturezaAtividade: 'comercio' })).toBe('1403');
        expect(cfopExiste('1405')).toBe(false);
    });
});
