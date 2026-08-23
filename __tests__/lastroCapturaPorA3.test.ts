// ============================================================================
// 🚨 METADE DA CARTEIRA CAPTURA POR A3 — e o farol mandava todos eles
// "destravar a captura"
//
// Paulo, 23/08, com o painel de captura na mão: das 404 empresas monitoradas,
// **202 estão bloqueadas por certificado A3**, que NÃO roda no cron em nuvem —
// quem as captura é o agente local `cfi-a3`.
//
// 🔴 Para essas 202, "zero documento na nuvem" não aponta captura quebrada:
// aponta o AGENTE que não rodou (ou não entregou) naquela competência. E as
// duas telas que o colaborador lê mandavam a ação errada:
//
//   · a **Rotina do Mês** (etapa 1): *"Rode a captura do cliente e confira o
//     Diagnóstico — pode ser certificado, procuração ou município sem
//     trilho"*;
//   · o **farol de lastro** (ficha × documentos, o caso EXPERTE de 15/08):
//     *"destrave a captura (📋 Status por Empresa diz o bloqueio)"*.
//
// Mandar meia carteira procurar defeito onde não há é o jeito conhecido de
// ensinar a equipe a ignorar o farol. **Causa junto do número, sempre.**
//
// ⚠️ **E A SEVERIDADE NÃO CAI.** O agente A3 escreve na MESMA coleção, então
// documento nenhum ali continua sendo lacuna de verdade — não é desenho.
// Baixar para âmbar (ou calar) trocaria um alarme com ação errada por um
// SILÊNCIO FALSO, e a Rotina voltaria a dar a competência por fechada sem
// lastro. É a régua de 22/08, no cruzamento CFI × SPED: trocar alarme falso
// por silêncio falso não é correção.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';
import { conferirFichaContraDocumentos } from '../sefaz-backend/ficha-x-documentos.js';

describe('🚨 o farol de lastro diz a causa certa para quem é A3', () => {
    const semDoc = (a3: boolean) => conferirFichaContraDocumentos({
        valorApurado: 7352.9, documentos: 0, rotulo: 'IPI', capturaPorAgenteLocal: a3,
    });

    it('a empresa A3 recebe a causa e a primeira parada dela', () => {
        const r = semDoc(true);
        expect(r.situacao).toBe('sem-documento-agente-local');
        expect(r.mensagem).toMatch(/A3/);
        expect(r.acao).toMatch(/cfi-a3/);
    });

    // 🚨 A trava que importa: severidade IGUAL. Silêncio falso é pior que
    // alarme com ação errada.
    it('e a severidade continua a MESMA — não vira âmbar nem some', () => {
        expect(semDoc(true).cor).toBe(semDoc(false).cor);
        expect(semDoc(true).cor).toBe('falha');
    });

    it('quem NÃO é A3 continua com a frase de sempre', () => {
        const r = semDoc(false);
        expect(r.situacao).toBe('sem-documento');
        expect(r.acao).toMatch(/destrave a captura/);
        expect(r.mensagem).not.toMatch(/A3/);
    });

    // A régua não pode inverter o caso com lastro nem o "sem valor".
    it('com documento por trás o farol segue verde, A3 ou não', () => {
        for (const a3 of [true, false]) {
            const r = conferirFichaContraDocumentos({ valorApurado: 100, documentos: 12, capturaPorAgenteLocal: a3 });
            expect({ a3, s: r.situacao, c: r.cor }).toEqual({ a3, s: 'com-lastro', c: 'ok' });
        }
    });

    // Falha de contagem continua NEUTRA — zero falso acenderia com o banco
    // cheio, que é o alarme que ensina a ignorar o farol.
    it('contagem indisponível não vira "sem documento" nem no A3', () => {
        const r = conferirFichaContraDocumentos({ valorApurado: 100, documentos: null, capturaPorAgenteLocal: true });
        expect(r.situacao).toBe('contagem-indisponivel');
    });
});

describe('🚨 e a etapa de CAPTURA da Rotina do Mês também', () => {
    const rotina = (a3: boolean) => montarRotinaFiscal({
        empresa: { id: 'e1', nome: 'EXPERTE', cnpj: '31947349000169', regime: 'lucro' },
        competencia: '2026-07',
        documentos: [],
        apuracao: { totalImpostos: 7352.9 },
        capturaAtiva: true,
        capturaPorAgenteLocal: a3,
    });

    const etapaDe = (r: any, id: string) => (r.etapas || []).find((e: any) => e.id === id);

    it('a empresa A3 é mandada conferir o AGENTE, não o bloqueio da captura', () => {
        const cap = etapaDe(rotina(true), 'captura');
        expect(cap.acao).toMatch(/cfi-a3/);
        expect(cap.acao).not.toMatch(/procuração/);
        expect(cap.resumo).toMatch(/A3/);
    });

    // ⚠️ Silenciar 202 empresas seria o defeito maior: a etapa continua
    // PENDENTE, e a competência não fecha.
    it('e a etapa continua PENDENTE — o mês não fecha por causa disso', () => {
        expect(etapaDe(rotina(true), 'captura').status).toBe(etapaDe(rotina(false), 'captura').status);
        expect(etapaDe(rotina(true), 'captura').status).toBe('pendente');
    });

    it('quem não é A3 mantém a frase de sempre', () => {
        const cap = etapaDe(rotina(false), 'captura');
        expect(cap.acao).toMatch(/Diagnóstico/);
        expect(cap.resumo).not.toMatch(/A3/);
    });

    // A apuração sem lastro segue acendendo nas DUAS — é o caso EXPERTE, que
    // criou o farol.
    it('a apuração sem lastro acende nas duas, A3 ou não', () => {
        for (const a3 of [true, false]) {
            const ap = etapaDe(rotina(a3), 'apuracao');
            expect({ a3, ok: ap.status !== 'concluida' }).toEqual({ a3, ok: true });
            expect(ap.lastro.situacao).toBe(a3 ? 'sem-documento-agente-local' : 'sem-documento');
        }
    });
});
