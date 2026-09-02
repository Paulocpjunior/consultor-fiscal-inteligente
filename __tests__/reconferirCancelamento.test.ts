/**
 * Caso Eunice / LANCHONETE JO BRAS (11/08): nota cancelada contando no
 * faturamento. A leitura do CFI estava certa — o cancelamento é que nunca
 * chegou, porque a SEFAZ não entrega ao emitente (Rej. 641) e o cofre traz o
 * XML autorizado, não o evento do dia seguinte.
 *
 * A trava que mais importa aqui: falha de consulta NUNCA vira "não cancelada".
 */
import {
    selecionarParaReconferir, lerRespostaCancelamento, resumirReconferencia,
} from '../sefaz-backend/reconferir-cancelamento.js';
import { docCancelado, direcaoEfetivaDoc } from '../sefaz-backend/xml-metadata-helper.js';

const REGUAS = { jaCancelado: docCancelado, direcaoEfetiva: direcaoEfetivaDoc };
const CHAVE = '3526085857853200019155001000000123100000012';   // 43 — inválida de propósito
const chaveDe = (n: number) => String(n).padStart(44, '3');

const saida = (over: any = {}) => ({
    id: 'd1', direcao: 'saida', status: 'autorizado', chave: chaveDe(1), modelo: '55',
    numero: 10, valorTotal: 100, ...over,
});

describe('seleção do que reconferir', () => {
    it('pega só saída ainda não cancelada e com chave de 44 dígitos', () => {
        const s = selecionarParaReconferir([
            saida({ id: 'a', numero: 3 }),
            saida({ id: 'b', numero: 1 }),
            saida({ id: 'ja', status: 'cancelado' }),
            saida({ id: 'entrada', direcao: 'entrada' }),
            saida({ id: 'semchave', chave: CHAVE }),
        ], REGUAS);

        expect(s.aConsultar.map((x: any) => x.id)).toEqual(['b', 'a']);   // ordenado por número
        expect(s.jaCanceladas).toBe(1);
        expect(s.naoSaida).toBe(1);
        expect(s.semChave).toBe(1);
        expect(s.cortadas).toBe(0);
    });

    it('a nota própria de ENTRADA (tpNF=0) não entra — ela não é saída', () => {
        const s = selecionarParaReconferir([saida({ tpNF: '0' })], REGUAS);
        expect(s.aConsultar).toHaveLength(0);
        expect(s.naoSaida).toBe(1);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 SÓ NF-e (modelo 55) — caso MV LIDER 639, 18/08 (rodada seguinte ao
    // cStat 653). A rodada voltou 20 de 20 "[indeterminado] ... cStat 618 —
    // Rejeicao: Chave de Acesso invalida (modelo diferente de 55)". A
    // ordenação por número colocava a série de NFC-e (numeração baixa,
    // 293-345) na FRENTE da série de NF-e (3736-3897, o alvo de verdade) —
    // rodada após rodada gastava a conta consultando NFC-e, que este
    // webservice nunca vai conseguir responder.
    // ═══════════════════════════════════════════════════════════════════════
    it('modelo 65 (NFC-e) nunca entra na fila — a própria SEFAZ recusa (cStat 618)', () => {
        const s = selecionarParaReconferir([
            saida({ id: 'nfce', modelo: '65', numero: 300 }),
            saida({ id: 'nfe', modelo: '55', numero: 3800 }),
        ], REGUAS);
        expect(s.aConsultar.map((x: any) => x.id)).toEqual(['nfe']);
        expect(s.naoMod55).toBe(1);
    });

    it('modelo derivado da CHAVE (sem campo `modelo` gravado) também filtra — NFC-e não some sem contagem', () => {
        // posições 21-22 da chave (índice 0-based 20-22) são o modelo.
        const chaveMod65 = `35260858578532000191${'65'}001000000123100000012`.padEnd(44, '0').slice(0, 44);
        const s = selecionarParaReconferir([
            saida({ id: 'semCampoModelo', modelo: undefined, chave: chaveMod65 }),
        ], REGUAS);
        expect(s.aConsultar).toHaveLength(0);
        expect(s.naoMod55).toBe(1);
    });

    it('trunca com o total à vista — lista cortada em silêncio é lida como "conferi tudo"', () => {
        const docs = Array.from({ length: 30 }, (_, i) => saida({ id: `d${i}`, numero: i, chave: chaveDe(i) }));
        const s = selecionarParaReconferir(docs, { ...REGUAS, limite: 10 });
        expect(s.aConsultar).toHaveLength(10);
        expect(s.total).toBe(30);
        expect(s.cortadas).toBe(20);
        expect(resumirReconferencia({ selecao: s, resultados: [] }).avisos.join(' '))
            // ⚠️ ASSERÇÃO TROCADA PELA INTENÇÃO (02/09): ela prendia o TEXTO
            // "parou em 10 de 30", e a frase mudou por decisão — a tela passou
            // a ENCADEAR as rodadas, então "rode de novo" virava um clique
            // inútil. O que ela protege continua: o TOTAL tem de aparecer,
            // senão a lista cortada se lê como "conferi tudo".
            .toMatch(/10 de 30/);
    });
});

describe('leitura da resposta da SEFAZ', () => {
    const evento = (cStat: string) => ({
        cStat: '138',
        xmls: [{
            xml: `<procEventoNFe><infEvento><tpEvento>110111</tpEvento><xJust>erro de digitação</xJust>`
                + `</infEvento><retEvento><infEvento><cStat>${cStat}</cStat><nProt>135260000123456</nProt>`
                + `<dhRegEvento>2026-07-15T10:00:00-03:00</dhRegEvento></infEvento></retEvento></procEventoNFe>`,
        }],
    });

    it('evento 110111 com cStat 135 ⇒ cancelada', () => {
        const r = lerRespostaCancelamento(evento('135'));
        expect(r.situacao).toBe('cancelada');
        expect(r.evento!.tpEvento).toBe('110111');
        expect(r.evento!.nProt).toBe('135260000123456');
        expect(r.evento!.xJust).toBe('erro de digitação');
    });

    it('cStat 155 (fora de prazo) também cancela — era o que o importer antigo perdia', () => {
        const r = lerRespostaCancelamento(evento('155'));
        expect(r.situacao).toBe('cancelada');
        expect(r.motivo).toMatch(/FORA DE PRAZO/);
    });

    it('evento REJEITADO não cancela', () => {
        expect(lerRespostaCancelamento(evento('573')).situacao).toBe('nao-cancelada');
    });

    it('protocolo legado com cStat 101 na própria nota ⇒ cancelada', () => {
        const r = lerRespostaCancelamento({
            cStat: '138',
            xmls: [{ xml: '<nfeProc><NFe><infNFe>x</infNFe></NFe><protNFe><infProt><cStat>101</cStat></infProt></protNFe></nfeProc>' }],
        });
        expect(r.situacao).toBe('cancelada');
        expect(r.motivo).toMatch(/legado/);
    });

    it('documento encontrado e sem evento ⇒ não cancelada', () => {
        const r = lerRespostaCancelamento({
            cStat: '138',
            xmls: [{ xml: '<nfeProc><NFe><infNFe>x</infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>' }],
        });
        expect(r.situacao).toBe('nao-cancelada');
    });

    // ─── A TRAVA QUE MANDA ──────────────────────────────────────────────────
    it('erro de rede NUNCA vira "não cancelada"', () => {
        const r = lerRespostaCancelamento({ erro: 'ECONNRESET' });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/não prova que a nota é válida/);
    });

    it('cStat 137 (nada localizado) é indeterminado, não "válida"', () => {
        const r = lerRespostaCancelamento({ cStat: '137', xMotivo: 'Nenhum documento localizado', xmls: [] });
        expect(r.situacao).toBe('indeterminado');
        expect(r.motivo).toMatch(/certificado sem autorização|UF diferente/);
    });

    it('resposta vazia também é indeterminado', () => {
        expect(lerRespostaCancelamento(null).situacao).toBe('indeterminado');
        expect(lerRespostaCancelamento({ cStat: '138', xmls: [] }).situacao).toBe('indeterminado');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 cStat 653 — "cancelada deveria puxar", e ele tinha razão (18/08)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Paulo, MV LIDER 639: consultou 3 chaves suspeitas uma a uma na tela
    // "Consultar NFe por chave" (com o certificado do ESCRITÓRIO, que não é
    // parte de nenhuma delas) e a SEFAZ respondeu nas três:
    //   cStat=653 · Rejeicao: NF-e Cancelada, arquivo indisponivel p/ download
    // Sem xmls (não entrega o conteúdo — é rejeição, não distribuição), o
    // código antigo caía no genérico "sem documento ⇒ indeterminado", que
    // existe pra cobrir certificado sem autorização/UF errada. São coisas
    // diferentes: ali a SEFAZ não disse quem é a nota; aqui ela disse que a
    // nota não vale mais.
    it('cStat 653 com xMotivo "Cancelada" ⇒ cancelada, mesmo sem xmls', () => {
        const r = lerRespostaCancelamento({
            cStat: '653', xMotivo: 'Rejeicao: NF-e Cancelada, arquivo indisponivel para download', xmls: [],
        });
        expect(r.situacao).toBe('cancelada');
        expect(r.evento!.cStat).toBe('653');
        expect(r.motivo).toMatch(/653/);
    });

    it('cStat 653 SEM a palavra "cancelad" no xMotivo não afirma nada — corroboração, não só o número', () => {
        const r = lerRespostaCancelamento({ cStat: '653', xMotivo: 'Rejeicao: outro motivo qualquer', xmls: [] });
        expect(r.situacao).toBe('indeterminado');
    });
});

describe('resumo com a CAUSA junto do número', () => {
    it('diz quanto sai da apuração e manda conferir se a guia já saiu', () => {
        const s = resumirReconferencia({
            selecao: { total: 2, cortadas: 0, aConsultar: [] },
            resultados: [
                { situacao: 'cancelada', valorTotal: 250.5 },
                { situacao: 'nao-cancelada', valorTotal: 100 },
            ],
        });
        expect(s.canceladas).toBe(1);
        expect(s.valorRemovido).toBe(250.5);
        expect(s.avisos.join(' ')).toMatch(/R\$ 250,50|250\.50/);
        expect(s.avisos.join(' ')).toMatch(/guia emitida/);
    });

    it('indeterminada NÃO é contada como resolvida, e o aviso diz isso', () => {
        const s = resumirReconferencia({
            selecao: { total: 1, cortadas: 0, aConsultar: [] },
            resultados: [{ situacao: 'indeterminado' }],
        });
        expect(s.canceladas).toBe(0);
        expect(s.naoCanceladas).toBe(0);
        expect(s.indeterminadas).toBe(1);
        expect(s.avisos.join(' ')).toMatch(/NÃO quer dizer que estão válidas/);
    });

    it('zero saída manda para a CAPTURA, não para o cancelamento', () => {
        const s = resumirReconferencia({ selecao: { total: 0, cortadas: 0, aConsultar: [] }, resultados: [] });
        expect(s.avisos.join(' ')).toMatch(/problema é de CAPTURA/);
        expect(s.avisos.join(' ')).toMatch(/Cobertura de Saída/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A PRÉVIA NÃO PODE FALAR NO PASSADO — o caso MV LIDER 639 (18/08)
// ═══════════════════════════════════════════════════════════════════════════
//
// Paulo: *"fui consultar essas notas da MV LIDER pra ver se estavam mesmo
// canceladas, realmente estão, mas no consultor não"*. O print mostra a causa:
// ele clicou em **Quantas seriam consultadas?** — a SIMULAÇÃO — e a tela
// respondeu, na mesma caixa, *"60 de 215 seriam consultadas"* e *"A rodada
// parou em 60 de 215 notas"*.
//
// Dois tempos verbais sobre o mesmo fato, e o segundo AFIRMA que uma rodada
// aconteceu. Nenhuma aconteceu: a pergunta à SEFAZ nunca foi feita. Quem lê
// conclui que a ferramenta já tentou e não achou nada — e para ali, com a
// competência fechando com nota cancelada dentro do faturamento.
describe('MV LIDER 639: prévia × rodada de verdade', () => {
    const selecao = { aConsultar: new Array(60).fill({}), total: 215, cortadas: 155 };

    it('na PRÉVIA, nada é dito no passado — e ela diz que não perguntou nada', () => {
        const r = resumirReconferencia({ selecao, resultados: [], simulado: true });
        const texto = r.avisos.join(' | ');
        expect(texto).not.toMatch(/rodada parou/);
        expect(texto).toMatch(/Ainda NÃO consultamos nada/);
        // E a frase que impede a leitura errada do "0 cancelada(s)".
        expect(texto).toMatch(/o que o app sabe — não o que a SEFAZ diz/);
    });

    it('a prévia DIZ quantas rodadas faltam — 215 notas em rodadas de 60 são 4', () => {
        const r = resumirReconferencia({ selecao, resultados: [], simulado: true });
        // Intenção: a prévia DIZ quantas rodadas o app vai fazer (antes ela
        // dizia quantas a PESSOA teria de fazer — hoje é um clique só).
        expect(r.avisos.join(' ')).toMatch(/4 rodadas/);
    });

    it('na rodada DE VERDADE o passado volta, agora verdadeiro', () => {
        const r = resumirReconferencia({
            selecao,
            resultados: new Array(60).fill({ situacao: 'nao-cancelada' }),
            simulado: false,
        });
        const texto = r.avisos.join(' | ');
        // Intenção: a rodada de verdade fala no PASSADO (ela perguntou), ao
        // contrário da prévia — foi a mistura dos dois tempos que travou a MV
        // LIDER em 18/08.
        expect(texto).toMatch(/perguntou 60 de 215/);
        expect(texto).not.toMatch(/Ainda NÃO consultamos/);
    });

    it('rodada única (sem corte) não promete rodada nenhuma', () => {
        const r = resumirReconferencia({
            selecao: { aConsultar: [{}], total: 1, cortadas: 0 },
            resultados: [{ situacao: 'nao-cancelada' }],
        });
        expect(r.avisos.join(' ')).not.toMatch(/rodada/i);
    });
});
