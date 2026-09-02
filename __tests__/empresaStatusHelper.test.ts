// @ts-expect-error modulo JS puro
import { classificarCapturaNfseNacionalAdn } from '../sefaz-backend/empresa-status-helper.js';
// @ts-expect-error modulo JS puro
import { pareceNfseNacional } from '../sefaz-backend/agent-xml-helper.js';

describe('classificarCapturaNfseNacionalAdn', () => {
    // ========================================================================
    // 🚨 A3 NÃO TEM AGENTE DE NFS-e — e o painel dizia que tinha (02/09)
    //
    // Paulo, sobre o SILVIO FREIRE: *"verifica push de NFS-e de entrada"* +
    // *"detalhe: este cliente usa certificado A3"*.
    //
    // ⚠️ FIXTURE TROCADA, e ela é o retrato do defeito: exigia
    // `{ ok: true, via: 'a3-local', motivo: null }` — ou seja, **descrevia** a
    // afirmação errada em vez de pegá-la. É a terceira vez que um teste desta
    // casa documenta a afirmação em vez de cobrá-la (o `/EXPIRA/` de 01/09 e o
    // `/ID do segredo/` de 02/09).
    // ========================================================================
    it('A3 NÃO é coberto: o agente local não captura NFS-e', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'A3',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: false,
        });

        expect(r.ok).toBe(false);
        expect(r.via).toBe('a3-sem-trilho-nfse');
        // 🚨 A frase tem de DIZER que o agente não cobre — sem isso a pessoa
        // espera por uma captura que nunca vem.
        expect(r.motivo).toMatch(/NUNCA NFS-e|nunca NFS-e/);
        // ⚠️ E que rodar o ADN não resolve: era essa a ação antiga, e o próprio
        // trilho recusa a empresa (achado 18 — aviso que aponta lugar que não
        // resolve).
        expect(r.motivo).toMatch(/não resolve/i);
        // ⚠️ As saídas REAIS vão na frase, senão a trava não tem caminho.
        expect(r.motivo).toMatch(/mesma raiz/i);
        expect(r.motivo).toMatch(/Importar|cofre|município/i);
    });

    // ⚠️ O A1 DA MATRIZ continua vencendo o A3: o ADN aceita mesma raiz (regra
    // de 27/08, caso J.N. VINATEX). Sem isto a filial com matriz A1 cairia no
    // bloqueio novo sem necessidade.
    it('A1 da matriz (mesma raiz) vence o A3 e continua capturando', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: false,
            temA1MesmaRaizValido: true,
            ehEscritorio: false,
            tipoCert: 'A3',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: false,
        });
        expect(r).toEqual({ ok: true, via: 'cloud-a1-raiz', motivo: null });
    });

    it('mantem A1 proprio valido como captura em nuvem', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: true,
            ehEscritorio: false,
            tipoCert: 'A1',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: true,
        });

        expect(r).toEqual({ ok: true, via: 'cloud-a1', motivo: null });
    });

    it('bloqueia certificado do escritorio/procuracao para ADN sem A1 proprio', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: true,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'escritorio',
            usaCertEscritorio: true,
            procuracaoEcacAtiva: true,
            certUploaded: false,
            certValido: false,
        });

        expect(r.ok).toBe(false);
        expect(r.via).toBe('bloqueada');
        expect(r.motivo).toContain('A1 próprio');
        expect(r.motivo).toContain('agente A3 local');
    });

    it('mantem flag inativa como pendencia operacional', () => {
        const r = classificarCapturaNfseNacionalAdn({
            nfseNacionalDfeAtivo: false,
            temA1ProprioValido: false,
            ehEscritorio: false,
            tipoCert: 'A3',
            usaCertEscritorio: false,
            procuracaoEcacAtiva: false,
            certUploaded: true,
            certValido: false,
        });

        expect(r.ok).toBe(false);
        expect(r.via).toBe('inativa');
        expect(r.motivo).toContain('desativada');
    });
});

describe('pareceNfseNacional', () => {
    it('identifica XML de NFS-e Nacional pelo infNFSe', () => {
        expect(pareceNfseNacional('<DFe><infNFSe Id="NFSe123"></infNFSe></DFe>', null)).toBe(true);
    });

    it('nao classifica NFe como NFS-e Nacional', () => {
        expect(pareceNfseNacional('<nfeProc><infNFe Id="NFe3526"></infNFe></nfeProc>', 'procNFe_v4.00.xsd')).toBe(false);
    });
});

// ============================================================================
// 🔒 A RÉGUA SE PROVA CONTRA O CÓDIGO — e a PRIMEIRA versão dela me pegou
//
// Eu ia afirmar "o agente A3 não captura NFS-e" medindo se o backend MENCIONA
// NFS-e no caminho dele. A varredura acusou o `agent-routes.js`, que de fato
// importa `importarDfeNfseNacional` — e por um instante a minha conclusão caiu.
//
// 📌 A TRIAGEM MOSTROU QUE OS DOIS FATOS CONVIVEM, e é essa a medida certa:
//   · o `POST /upload-batch` ACEITA NFS-e Nacional (detecta e importa) — é
//     REDE, para o dia em que chegar;
//   · mas o agente **não tem por onde BUSCAR**: `GET /state/:cnpj` devolve
//     `sefaz_state`, que é o cursor do **DistDFe da SEFAZ** (NF-e). Não existe
//     rota que ofereça o cursor do **ADN** (`nfse_nacional_dfe_state`).
//
// ✅ E O DONO FECHOU A MEDIÇÃO (Paulo, 02/09): *"o agente só puxa NF-e da
// SEFAZ, não puxa NFS-e"*. Rota que aceita ≠ trilho que traz.
//
// ⚠️ Por isso a assinatura mudou de "menciona NFS-e" para **"oferece o cursor
// do ADN"**: a primeira acusava código certo (a rede do upload), e alarme sobre
// código certo é o jeito conhecido de a equipe desligar a trava.
//
// No dia em que alguém der ao agente o cursor do ADN, esta trava cai e a régua
// é revista — em vez de envelhecer errada em silêncio, que é como ela viveu.
// ============================================================================
describe('🔎 o agente A3 não tem por onde BUSCAR NFS-e', () => {
    const { readFileSync, readdirSync } = require('fs');
    const { join } = require('path');
    const RAIZ = join(__dirname, '..');

    // Lê CÓDIGO, nunca a prosa que o explica — os comentários desta correção
    // citam o ADN justamente para dizer que ele NÃO é oferecido ao agente.
    const semComentario = (s: string) => s.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const arquivosDoAgente = () => readdirSync(join(RAIZ, 'sefaz-backend'))
        .filter((f: string) => /^agent.*\.js$/i.test(f) && !f.endsWith('.d.ts'));

    it('a varredura tem o que ler (varredura vazia é trava falsa)', () => {
        expect(arquivosDoAgente().length).toBeGreaterThan(0);
    });

    it('nenhuma rota do agente oferece o cursor do ADN', () => {
        for (const f of arquivosDoAgente()) {
            const fonte = semComentario(readFileSync(join(RAIZ, 'sefaz-backend', f), 'utf8'));
            // O cursor do ADN mora em `nfse_nacional_dfe_state`. Sem ele o
            // agente não sabe de onde retomar — e portanto não busca.
            expect(fonte).not.toMatch(/nfse_nacional_dfe_state/);
        }
    });

    it('o cursor que o agente recebe é o do DistDFe (NF-e)', () => {
        const fonte = readFileSync(join(RAIZ, 'sefaz-backend/agent-routes.js'), 'utf8');
        expect(fonte).toMatch(/collection\('sefaz_state'\)/);
    });

    // 🔴 E O TRILHO DO ADN CONCORDA: ele já RECUSAVA A3. Era essa a
    // contradição — a elegibilidade dizia "não roda" e o painel dizia "✓ ok".
    it('a elegibilidade do ADN recusa A3, como o painel agora também', () => {
        const fonte = readFileSync(join(RAIZ, 'sefaz-backend/nfse-nacional-dfe-eligibility.js'), 'utf8');
        expect(fonte).toMatch(/tipoCert === 'A3'/);
        expect(fonte).toMatch(/elegivel: false/);
    });
});
