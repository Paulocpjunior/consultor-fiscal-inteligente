/**
 * sync-orchestrator-cte.js — a captura de CT-e precisa de cursor/lock
 * PRÓPRIOS, nunca os do NF-e.
 *
 * Um cursor compartilhado resolveria pra um dos dois documentos e o outro
 * ficaria "sincronizado" com o NSU do lado errado — é a mesma armadilha das
 * "duas formas" que já mordeu este projeto (11/08, participantes achatado x
 * aninhado), agora entre NF-e e CT-e em vez de entre dois formatos do mesmo
 * documento. A trava aqui é por VARREDURA DE FONTE, não por execução real
 * (o orquestrador de CT-e depende de Firestore + rede da SEFAZ, caro de
 * mockar por pouco ganho — mesma régua de `reconferirRebuscaAutomatica`).
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(
    path.resolve(__dirname, '../sefaz-backend/sync-orchestrator-cte.js'), 'utf8',
);

describe('sync-orchestrator-cte — coleções PRÓPRIAS, nunca as do NF-e', () => {
    it('usa sefaz_locks_cte e sefaz_state_cte, nunca sefaz_locks/sefaz_state cru', () => {
        expect(src).toContain("collection('sefaz_locks_cte')");
        expect(src).toContain("collection('sefaz_state_cte')");
        // As coleções do NF-e não podem aparecer aqui — cursor compartilhado
        // faria um documento "sumir" do lado que não escreveu por último.
        expect(src).not.toMatch(/collection\('sefaz_locks'\)/);
        expect(src).not.toMatch(/collection\('sefaz_state'\)/);
    });

    it('reusa calcularCursorSeguro do orquestrador de NF-e — nunca reescreve a régua', () => {
        expect(src).toMatch(/import \{ calcularCursorSeguro \} from '\.\/sync-orchestrator\.js';/);
        expect(src).toContain('calcularCursorSeguro({');
    });

    it('reusa importarXmlSefaz — o mesmo leitor que já entende infCte/chCTe/schema resCTe', () => {
        expect(src).toMatch(/import \{ importarXmlSefaz, registrarErroSefaz \} from '\.\/xml-importer\.js';/);
        expect(src).toContain('await importarXmlSefaz({');
    });

    it('chama o cliente CTe (consultaDistDFeCteComCert), não o de NF-e', () => {
        expect(src).toMatch(/import \{ consultaDistDFeCteComCert \} from '\.\/cte-client\.js';/);
        expect(src).toContain('await consultaDistDFeCteComCert({');
    });
});
