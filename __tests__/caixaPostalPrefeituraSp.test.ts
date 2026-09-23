// ============================================================================
// 🚨 O CANAL "PREFEITURA SP" DIZIA "CCM NÃO CONFIGURADO" PARA A CARTEIRA
// INTEIRA — inclusive para quem tem CCM e para quem nem é de SP.
//
// 29/08, na sequência do caso LAV. O provider tem a assinatura
// `listarMensagensPrefeituraSP(empresaCnpj, ccmSp)` e **os dois chamadores
// passavam UM argumento só**: `ccmSp` chegava sempre `undefined`, o canal caía
// no early return e devolvia, para TODA empresa, *"CCM (inscrição municipal
// SP) não configurado — preencha em Empresas → Dados Fiscais"*.
//
// 🔴 São DOIS defeitos somados:
//  1. a frase é FALSA sobre o cadastro de quem preencheu o CCM — o custo do
//     dia inteiro do caso LAV, de novo;
//  2. e ela manda preencher um campo que a maioria da carteira NÃO TEM E NÃO
//     PRECISA (o CCM só existe em SP capital). É o "aviso que aponta um lugar
//     que não resolve" (achado 18, 21/08) na forma mais cara: a pessoa
//     procura, preenche, e nada muda.
//
// 📌 REGRA QUE FICA: **argumento que ninguém passa não quebra nada — ele faz a
// função responder sobre o caso vazio, todo dia, com confiança.** É a família
// do `saldoCredorIpiAnterior` (19/08), que o gerador lia e nenhum orquestrador
// passava, e do `obrigacoesStPorUf`, que fez o E250 nunca sair.
// ============================================================================
import { canalPrefeituraSp } from '../sefaz-backend/caixa-postal-prefeitura-sp.js';

const SP_CAPITAL = '3550308';
const GUARULHOS = '3518800';

describe('🚨 empresa que NÃO é de SP capital', () => {
    const c = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: GUARULHOS } });

    it('o canal não se aplica — e isso NÃO é pendência', () => {
        expect(c.situacao).toBe('nao-se-aplica');
        expect(c.aplicavel).toBe(false);
    });

    // 🚨 O CORAÇÃO DA CORREÇÃO: a frase antiga mandava preencher o CCM, que a
    // empresa não tem e não precisa. Preencher não mudaria NADA.
    it('NÃO manda preencher CCM', () => {
        expect(String(c.motivo)).not.toMatch(/preencha/i);
        expect(String(c.motivo)).not.toMatch(/não cadastrado/i);
    });

    it('diz por onde a NFS-e dela chega de verdade', () => {
        expect(String(c.motivo)).toMatch(/Padrão Nacional \(ADN\)/);
        expect(String(c.motivo)).toMatch(/importação do próprio município/);
    });

    it('nomeia o município, para quem lê não precisar procurar', () => {
        expect(String(c.motivo)).toMatch(/Guarulhos\/SP/);
    });

    // ⚠️ Mesmo com CCM gravado por engano, quem manda é o MUNICÍPIO.
    it('CCM preenchido em empresa de fora não torna o canal aplicável', () => {
        const x = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: GUARULHOS, ccmSp: '12345678' } });
        expect(x.situacao).toBe('nao-se-aplica');
    });
});

describe('empresa de SP capital', () => {
    it('sem CCM, a frase antiga era VERDADEIRA e continua', () => {
        const c = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: SP_CAPITAL } });
        expect(c.situacao).toBe('sem-ccm');
        expect(c.aplicavel).toBe(true);
        expect(String(c.motivo)).toMatch(/Dados Fiscais/);
    });

    it('com CCM, o canal fica pronto e sem motivo', () => {
        const c = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: SP_CAPITAL, ccmSp: '1.234.567-8' } });
        expect(c.situacao).toBe('pronto');
        expect(c.ccm).toBe('12345678');
        expect(c.motivo).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 O CCM VEM DO DONO — as duas formas, e a sequência de zeros como VAZIO.
//
// Em 29/08 o CCM tinha QUATRO cópias e `'00000000'` (contorno antigo da equipe)
// atravessava o backend inteiro como se fosse inscrição.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 o CCM sai do dono, não de uma leitura nova', () => {
    it('lê a forma ACHATADA (cadastro legado do topo)', () => {
        const c = canalPrefeituraSp({ codMunIBGE: SP_CAPITAL, ccmSp: '12345678' });
        expect(c.situacao).toBe('pronto');
        expect(c.ccm).toBe('12345678');
    });

    it('a sequência de zeros vale como VAZIO — nunca como inscrição', () => {
        const c = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: SP_CAPITAL, ccmSp: '00000000' } });
        expect(c.situacao).toBe('sem-ccm');
        expect(c.ccm).toBe('');
    });
});

// ⚠️ AUSÊNCIA NÃO É PROVA (a régua da uf-desconhecida, 15/08): sem município
// cadastrado, tratar como "não se aplica" apagaria o canal justamente de quem
// ele existe para servir.
describe('⚠️ sem município cadastrado, o CCM decide', () => {
    it('com CCM, o canal se aplica', () => {
        expect(canalPrefeituraSp({ dadosFiscais: { ccmSp: '12345678' } }).situacao).toBe('pronto');
    });

    it('sem CCM e sem município, não se aplica — e não manda preencher nada', () => {
        const c = canalPrefeituraSp({});
        expect(c.situacao).toBe('nao-se-aplica');
        expect(String(c.motivo)).not.toMatch(/preencha/i);
    });

    it('empresa nula não explode', () => {
        expect(canalPrefeituraSp(null).situacao).toBe('nao-se-aplica');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A TRAVA É POR VARREDURA: o argumento tem de VIAJAR.
//
// Nada quebrou quando ele parou de viajar — o canal só passou a responder
// sobre o caso vazio, todo dia. Trava por lista envelheceria no próximo
// chamador; esta cobra o CAMINHO inteiro.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 o doc da empresa viaja do laço até o canal', () => {
    const ler = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');
    // Varredura lê CÓDIGO, nunca PROSA — o comentário que EXPLICA a correção
    // reprovaria a correção (a mordida do ISS em 22/08).
    const semComentario = (s: string) => s
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const provider = semComentario(ler('sefaz-backend/caixa-postal-provider.js'));
    const orq = semComentario(ler('sefaz-backend/caixa-postal-orchestrator.js'));

    it('o provider pergunta ao DONO em vez de decidir pelo CCM solto', () => {
        expect(provider).toMatch(/from '\.\/caixa-postal-prefeitura-sp\.js'/);
        expect(provider).toMatch(/canalPrefeituraSp\(/);
    });

    // 🚨 A CHAMADA de UM argumento é exatamente o defeito.
    //
    // 🐛 E a 1ª versão desta varredura nasceu LARGA: ela casava também a
    // DECLARAÇÃO do provider MOCK (`async listarMensagensPrefeituraSP(
    // empresaCnpj)`), que é código certo — o mock gera mensagem fictícia e não
    // olha cadastro nenhum. Alarme sobre código certo é o que faz a equipe
    // desligar a trava, então a assinatura casa só a CHAMADA (`this.`).
    it('nenhum chamador chama o canal com um argumento só', () => {
        const soltos = provider.match(/this\.listarMensagensPrefeituraSP\(empresaCnpj\)/g) || [];
        expect(soltos).toHaveLength(0);
    });

    it('o laço da carteira passa o doc que ele JÁ TEM — sem leitura por empresa', () => {
        expect(orq).toMatch(/sincronizarEmpresa\(emp\.id, emp\.cnpj, emp\)/);
    });

    it('o doc chega ao provider', () => {
        expect(orq).toMatch(/listarTodasMensagens\(empresaCnpj, 'SP', empresaDoc\)/);
    });
});
