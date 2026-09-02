// @ts-expect-error modulo JS puro
import { respostaSaeParaLeitura, lerCancelamentoNfce, conferirChaveNfce, chaveDoIdDeEvento, entradaParaChave } from '../sefaz-backend/sae-nfce-cancelamento.js';

// ============================================================================
// 🚨 NFC-e CANCELADA APARECENDO COM VALOR — e o "Reconferir" nunca ia resolver
//
// Paulo, 02/09: *"NFC-E 1194 da empresa 0065 - ARMAZEM DE BICHOS está cancelada
// e ela aparece com valor no consultor, dei o botão reconferir e continua com o
// valor"*, com o ID do evento na mão — e o detalhe que fecha o eixo:
// *"Essa nota é uma NFC-E, modelo 65"*.
//
// O ID dele é o alvo destes testes. Nada de cliente entra no repo além do que
// ele já mandou: a chave é a que o próprio ID carrega.
// ============================================================================
const ID_EVENTO_DO_CASO = 'ID1101113526080584663800016165001000001194187869737301';
const CHAVE_DO_CASO = '35260805846638000161650010000011941878697373';

describe('a entrada aceita o que o dono TEM na mão', () => {
    // 📌 Ele trouxe o ID do evento, não a chave. Pedir a chave de volta seria
    // devolver a ele um recorte que o app sabe fazer (régua de 02/09: quando o
    // app tem como saber a resposta, perguntar não é entrega).
    it('extrai a chave do ID do evento', () => {
        expect(chaveDoIdDeEvento(ID_EVENTO_DO_CASO)).toBe(CHAVE_DO_CASO);
    });

    it('o ID do caso é de CANCELAMENTO (110111) e de modelo 65', () => {
        expect(ID_EVENTO_DO_CASO.replace(/^ID/, '').slice(0, 6)).toBe('110111');
        expect(CHAVE_DO_CASO.substring(20, 22)).toBe('65');
    });

    it('aceita a chave crua e o ID, dizendo de onde veio', () => {
        expect(entradaParaChave(CHAVE_DO_CASO)).toMatchObject({ ok: true, chave: CHAVE_DO_CASO, origem: 'chave' });
        expect(entradaParaChave(ID_EVENTO_DO_CASO)).toMatchObject({ ok: true, chave: CHAVE_DO_CASO, origem: 'id-de-evento' });
    });

    it('entrada ilegível RECUSA dizendo o que colar', () => {
        const r = entradaParaChave('nota 1194');
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/44 dígitos|ID do evento/i);
    });
});

describe('a chave diz o MODELO, e o modelo decide o webservice', () => {
    // ⚠️ Espelho da recusa que a tela já faz do outro lado: perguntar ao SAE por
    // uma NF-e mod 55 devolveria um "não achei" que se lê como "a nota não
    // existe" — dizer a falha errada manda procurar no lugar errado.
    it('recusa modelo 55 apontando a aba certa', () => {
        const ch55 = `${CHAVE_DO_CASO.substring(0, 20)}55${CHAVE_DO_CASO.substring(22)}`;
        const r = conferirChaveNfce(ch55);
        expect(r.ok).toBe(false);
        expect(r.modelo).toBe('55');
        expect(r.motivo).toMatch(/modelo 65/);
        expect(r.motivo).toMatch(/🚫|NF-e \(55\)/);
    });

    it('aceita modelo 65 e devolve o CNPJ do emitente da própria chave', () => {
        const r = conferirChaveNfce(CHAVE_DO_CASO);
        expect(r.ok).toBe(true);
        expect(r.cnpjEmitente).toBe('05846638000161');
    });
});

describe('quem DECIDE continua sendo o dono único da leitura', () => {
    // ✂️ Escrever um segundo leitor aqui faria a MESMA nota ser julgada de dois
    // jeitos. Este módulo só ADAPTA a resposta do SAE para a forma do dono.
    it('evento 110111 com cStat 135 vira CANCELADA', () => {
        const r = lerCancelamentoNfce({
            cStat: '200',
            xMotivo: 'Download realizado',
            nfeProcXml: '<nfeProc><infNFe/></nfeProc>',
            eventosXml: ['<procEventoNFe><tpEvento>110111</tpEvento><cStat>135</cStat>'
                + '<dhRegEvento>2026-08-20T10:00:00-03:00</dhRegEvento><nProt>135260</nProt>'
                + '<xJust>erro de digitacao</xJust></procEventoNFe>'],
        });
        expect(r.situacao).toBe('cancelada');
        expect(r.evento).toMatchObject({ tpEvento: '110111', nProt: '135260' });
    });

    // ⚠️ Homologado FORA DE PRAZO (155) é cancelamento igual — era justamente
    // este que o importer antigo deixava passar (11/08).
    it('cStat 155 (fora de prazo) também é cancelamento', () => {
        const r = lerCancelamentoNfce({
            cStat: '200',
            eventosXml: ['<procEventoNFe><tpEvento>110111</tpEvento><cStat>155</cStat></procEventoNFe>'],
        });
        expect(r.situacao).toBe('cancelada');
    });

    it('autorizada sem evento é VIGENTE — prova positiva', () => {
        const r = lerCancelamentoNfce({
            cStat: '200', xMotivo: 'Download realizado',
            nfeProcXml: '<nfeProc><infNFe/><infProt><cStat>100</cStat></infProt></nfeProc>',
            eventosXml: [],
        });
        expect(r.situacao).toBe('nao-cancelada');
    });

    // 🚨 A FRASE DO `indeterminado` MUDA DE TRILHO, e isso é decisão declarada:
    // a do dono fala em "certificado sem autorização para este CNPJ ou UF
    // diferente" — no SAE isso é FALSO (o cert é o do PRÓPRIO emitente e não há
    // escolha de UF). A SITUAÇÃO continua sendo a dele; só a frase é do trilho.
    it('sem autorizada e sem evento: indeterminado com a frase do SAE', () => {
        const r = lerCancelamentoNfce({ cStat: '999', xMotivo: 'Rejeicao qualquer', eventosXml: [] });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/SAE-NFC-e/);
        expect(r.motivo).not.toMatch(/UF diferente/);
        // ⚠️ E ele DIZ a possibilidade que o app não pode descartar: o
        // webservice existe para entregar a autorizada, e pode simplesmente não
        // contar cancelamento. Afirmar "não está cancelada" aqui seria devolver
        // ao faturamento uma nota que a SEFAZ nunca defendeu.
        expect(r.motivo).toMatch(/pode simplesmente NÃO contar cancelamento/);
    });

    // ⚠️ Falha de REDE não é resposta.
    it('erro de consulta não vira "a nota vale"', () => {
        const r = lerCancelamentoNfce({ erro: 'timeout' });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).not.toMatch(/A nota vale/);
    });

    // ⚠️ Os EVENTOS vêm ANTES da autorizada na lista: o dono varre em ordem, e
    // pôr a autorizada na frente deixaria o veredito dependente da ordem.
    it('o evento é lido ANTES da autorizada', () => {
        const forma = respostaSaeParaLeitura({
            nfeProcXml: '<nfeProc/>',
            eventosXml: ['<procEventoNFe/>'],
        });
        expect(forma.xmls[0].xml).toContain('procEventoNFe');
    });
});

// ============================================================================
// 🔒 A CAUSA SE PROVA CONTRA O CÓDIGO — "pergunta uma vez e nunca mais"
//
// O que faz a NFC-e cancelada continuar valendo no app não é o botão falhando:
// é o dedup da captura ser por EXISTÊNCIA. Nota já baixada nunca é rebaixada, e
// o cancelamento acontece SEMPRE depois da autorização.
//
// No dia em que a captura passar a reperguntar, esta trava cai e a régua é
// revista — em vez de envelhecer errada em silêncio.
// ============================================================================
describe('🔎 por que nenhum trilho automático descobre o cancelamento', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const RAIZ = join(__dirname, '..');
    const semComentario = (s: string) => s.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    it('a captura de NFC-e pula a nota que já existe (dedup por existência)', () => {
        const fonte = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/sefaz-sp-nfce-orchestrator.js'), 'utf8'));
        expect(fonte).toMatch(/snap\.exists[\s\S]{0,80}jaCompletas\+\+/);
    });

    it('o download do SAE deixou de descartar o evento', () => {
        const fonte = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/sefaz-sp-nfce-client.js'), 'utf8'));
        expect(fonte).toMatch(/procEventoNFe/);
        expect(fonte).toMatch(/eventosXml/);
    });

    // 🔴 E o webservice de NF-e não cobre o buraco: ele recusa modelo 65
    // (cStat 618, provado na MV LIDER em 19/08) — a tela já diz isso.
    it('a reconferência de NF-e continua tirando o modelo 65 da fila, DIZENDO', () => {
        const fonte = readFileSync(join(RAIZ, 'sefaz-backend/reconferir-cancelamento.js'), 'utf8');
        expect(fonte).toMatch(/naoMod55|modelo 55/);
    });

    // 📌 Rota nova nasce com o BOTÃO que a chama (regra de 13/08): rota sem
    // caminho na interface é código morto com cara de entrega.
    it('a rota nova tem botão na tela', () => {
        const servico = readFileSync(join(RAIZ, 'services/saeNfceService.ts'), 'utf8');
        expect(servico).toMatch(/sae-nfce\/reconferir-chave/);
        const tela = readFileSync(join(RAIZ, 'components/xml/SaeNfceCaptura.tsx'), 'utf8');
        expect(tela).toMatch(/reconferirNfcePorChave/);
    });

    // ⚠️ E a gravação passa pelo DONO ÚNICO (21/08): rota que vê o cancelamento
    // e grava do seu jeito foi o que deixou o 🔎 mudo.
    it('a rota grava pelo dono único do cancelamento', () => {
        const fonte = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/sefaz-sp-nfce-routes.js'), 'utf8'));
        expect(fonte).toMatch(/gravarCancelamentoConfirmado/);
        expect(fonte).toMatch(/carimbarPerguntaSefaz/);
        // Nada de status escrito à mão nesta rota.
        expect(fonte).not.toMatch(/status:\s*'cancelado'/);
    });
});
