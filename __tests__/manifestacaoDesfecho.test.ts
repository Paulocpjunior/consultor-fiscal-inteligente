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
import {
    desfechoDaManifestacao, eventoDaManifestacao, CSTAT_JA_EXISTIA, marcaDoPrazoEncerrado, prazoDaManifestacaoEncerrado,
// @ts-expect-error módulo .js puro sem tipos
} from '../sefaz-backend/manifestacao-desfecho.js';
import { manifestacaoGravada, manifestacaoComPrazoEncerrado, motivoDaManifestacaoNaoGravada } from '../services/manifestoService';
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

/**
 * ⏱ 596 — PRAZO ENCERRADO (01/10, ALMEIDA COMERCIO nº 187: "Rejeicao: Evento
 * apresentado apos o prazo permitido para o evento: [10 dias]"). Definitivo:
 * não grava evento (não houve ciência), grava o FATO na nota.
 */
describe('596 — prazo do evento encerrado na SEFAZ', () => {
    const retorno = { cStatLote: '128', eventos: [{ cStat: '596', xMotivo: 'Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]' }] };

    it('é desfecho próprio: não registra evento, registra o prazo', () => {
        const d = desfechoDaManifestacao(retorno);
        expect(d.situacao).toBe('prazo-encerrado');
        expect(d.registraEvento).toBe(false);
        expect(d.registraPrazoEncerrado).toBe(true);
        expect(d.frase).toMatch(/prazo da SEFAZ encerrado \(596/);
    });

    it('a marca vai para a nota sem undefined e vale só para o tipo do evento', () => {
        const marca = marcaDoPrazoEncerrado({ desfecho: desfechoDaManifestacao(retorno), tipo: 'ciencia', agoraIso: '2026-10-01T12:00:00Z' });
        expect(Object.values(marca).every((v) => v !== undefined)).toBe(true);
        expect(marca).toMatchObject({ tipo: 'ciencia', cStat: '596', por: 'manifesto-auto' });
        expect(prazoDaManifestacaoEncerrado({ manifestacaoPrazoEncerrado: marca }, 'ciencia')).toBe(true);
        expect(prazoDaManifestacaoEncerrado({ manifestacaoPrazoEncerrado: marca }, 'confirmacao')).toBe(false);
        expect(prazoDaManifestacaoEncerrado({}, 'ciencia')).toBe(false);
    });

    it('a tela não chama de ✔ nem de ✖ — chama de prazo encerrado', () => {
        const r = { ok: false, desfecho: desfechoDaManifestacao(retorno) };
        expect(manifestacaoGravada(r)).toBe(false);
        expect(manifestacaoComPrazoEncerrado(r)).toBe(true);
        expect(manifestacaoComPrazoEncerrado({ ok: false, desfecho: desfechoDaManifestacao({ eventos: [{ cStat: '215' }] }) })).toBe(false);
    });
});
