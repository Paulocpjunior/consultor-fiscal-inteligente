/**
 * 📨 O DESFECHO DA MANIFESTAÇÃO É FATO, NUNCA "HTTP 200" (28/09).
 *
 * Paulo, validando a etapa 2 da Rotina: "consigo marcar como ciente, porém
 * quando atualizo ele volta a aparecer como sem ciência". A rota devolvia 200
 * com o retorno cru da SEFAZ e a tela lia qualquer 200 como ✔; o evento só
 * era gravado com cStat 135/136 — recusa passava como sucesso mudo.
 *
 * Fatos cobrados: 135/136 grava; 573 (duplicidade = já existia na SEFAZ)
 * grava e DIZ que já existia; outro cStat não grava e nomeia o motivo; lote
 * sem evento não grava e nomeia o lote; a tela só mostra ✔ quando gravou.
 */
// @ts-expect-error módulo .js puro sem tipos
import { desfechoDaManifestacao, eventoDaManifestacao, CSTAT_JA_EXISTIA } from '../sefaz-backend/manifestacao-desfecho.js';
import { manifestacaoGravada, motivoDaManifestacaoNaoGravada } from '../services/manifestoService';
import { readFileSync } from 'fs';
import { join } from 'path';

const ret = (eventos: any[], lote: any = { cStatLote: '128', xMotivoLote: 'Lote de evento processado' }) => ({ ...lote, eventos });

describe('desfechoDaManifestacao', () => {
    it('135/136 → aceita, grava o evento', () => {
        for (const c of ['135', '136']) {
            const d = desfechoDaManifestacao(ret([{ cStat: c, xMotivo: 'Evento registrado e vinculado a NF-e', nProt: '1', tpEvento: '210210' }]));
            expect(d).toMatchObject({ situacao: 'aceita', cStat: c, registraEvento: true });
        }
    });

    it('573 (duplicidade) → já existia na SEFAZ: grava o evento e diz isso', () => {
        const d = desfechoDaManifestacao(ret([{ cStat: '573', xMotivo: 'Rejeicao: Duplicidade de evento' }]));
        expect(d).toMatchObject({ situacao: 'ja-existia', cStat: CSTAT_JA_EXISTIA, registraEvento: true });
        expect(d.frase).toMatch(/já estava registrada/);
        const evt = eventoDaManifestacao({ evt: { cStat: '573', xMotivo: 'Rejeicao: Duplicidade de evento' }, tipo: 'ciencia', tpEventoPadrao: '210210', jaExistia: true });
        expect(evt).toMatchObject({ tipo: 'manifestacao_ciencia', tpEvento: '210210', cStat: '573', jaExistiaNaSefaz: true, nSeqEvento: '1' });
    });

    it('outra recusa → não grava e nomeia cStat + xMotivo', () => {
        const d = desfechoDaManifestacao(ret([{ cStat: '656', xMotivo: 'Rejeicao: Consumo Indevido' }]));
        expect(d).toMatchObject({ situacao: 'recusada', cStat: '656', registraEvento: false });
        expect(d.frase).toMatch(/656/);
        expect(d.frase).toMatch(/Consumo Indevido/);
    });

    it('lote sem evento → sem resposta, não grava, nomeia o lote', () => {
        const d = desfechoDaManifestacao(ret([], { cStatLote: '236', xMotivoLote: 'Rejeicao: Chave de Acesso com digito verificador invalido' }));
        expect(d).toMatchObject({ situacao: 'sem-resposta', cStat: '236', registraEvento: false });
        expect(d.frase).toMatch(/236/);
        expect(desfechoDaManifestacao(null).registraEvento).toBe(false);
        expect(desfechoDaManifestacao(undefined).situacao).toBe('sem-resposta');
    });

    it('o evento gravado na aceitação não leva o carimbo de "já existia"', () => {
        const evt = eventoDaManifestacao({ evt: { cStat: '135', tpEvento: '210210', nProt: '9', dhRegEvento: '2026-09-28T10:00:00-03:00' }, tipo: 'ciencia', capturadoPor: { email: 'x@sp.com' } });
        expect(evt).toMatchObject({ cStat: '135', nProt: '9', importadoPor: 'x@sp.com' });
        expect('jaExistiaNaSefaz' in evt).toBe(false);
    });
});

describe('a tela só mostra ✔ quando GRAVOU', () => {
    it('manifestacaoGravada lê o desfecho, não o status HTTP', () => {
        expect(manifestacaoGravada({ ok: true, desfecho: { situacao: 'aceita', cStat: '135', xMotivo: null, registraEvento: true, frase: 'x' } })).toBe(true);
        expect(manifestacaoGravada({ ok: true, desfecho: { situacao: 'ja-existia', cStat: '573', xMotivo: null, registraEvento: true, frase: 'x' } })).toBe(true);
        expect(manifestacaoGravada({ ok: false, desfecho: { situacao: 'recusada', cStat: '656', xMotivo: 'Consumo Indevido', registraEvento: false, frase: 'SEFAZ recusou (656)' } })).toBe(false);
        expect(manifestacaoGravada({})).toBe(false);            // 200 sem desfecho (o defeito de hoje) NÃO é sucesso
        expect(manifestacaoGravada({ erro: 'HTTP 403' })).toBe(false);
        expect(motivoDaManifestacaoNaoGravada({ desfecho: { situacao: 'recusada', cStat: '656', xMotivo: null, registraEvento: false, frase: 'SEFAZ recusou (656)' } })).toMatch(/656/);
        expect(motivoDaManifestacaoNaoGravada({ erro: 'HTTP 403' })).toBe('HTTP 403');
    });

    it('nenhum chamador de manifestarUmaChave decide sucesso pela ausência de `erro`', () => {
        const raiz = join(__dirname, '..');
        for (const rel of ['components/RotinaFiscalPainel.tsx', 'components/CapturaDiagnosticoPanel.tsx']) {
            const src = readFileSync(join(raiz, rel), 'utf8');
            expect(src).toMatch(/manifestacaoGravada\(/);
            expect(src).not.toMatch(/r\.erro \? `✕/);
        }
    });
});
