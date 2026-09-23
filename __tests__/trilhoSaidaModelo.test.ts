// @ts-expect-error modulo JS puro
import { trilhoDaNfceSaida, avisoDaLinhaNfce } from '../sefaz-backend/trilho-saida-modelo.js';

// ============================================================================
// 🚨 "NÃO PUXOU TODAS AS NFC-E, SÓ PUXOU 1" (02/09, Paulo, MV LIDER 0639)
//
// A tabela mostrava `65 · série 1 · 347–347 · 1 autorizada` ao lado de 126
// notas do modelo 55 — e o buraco se lê como FALHA DO APP.
//
// 📌 A causa é o CERTIFICADO, e é medida: a captura de NFC-e roda pelo
// SAE-NFC-e, que é mTLS com o A1 do PRÓPRIO contribuinte (o orquestrador
// carrega um .pfx). Com A3 a chave vive dentro do cartão e NÃO roda no Cloud
// Run — quem traz é o Agente A3. Enquanto ninguém o rodar, o buraco continua,
// e não há defeito nenhum a procurar.
// ============================================================================
describe('trilhoDaNfceSaida — por qual porta a NFC-e entra', () => {
    it('A3: NÃO roda no servidor, e a frase diz QUEM traz e o que fazer', () => {
        const t = trilhoDaNfceSaida({ tipoCert: 'A3', certUploaded: true, certValido: true });
        expect(t.via).toBe('agente-a3');
        expect(t.rodaNaNuvem).toBe(false);
        expect(t.motivo).toMatch(/Agente A3/);
        expect(t.motivo).toMatch(/não roda no Cloud Run/);
        // 🚨 E DIZ QUE NÃO É FALHA DE CAPTURA — sem isso a pessoa abre chamado
        // sobre um app que está certo.
        expect(t.motivo).toMatch(/não é falha de captura/i);
        // ⚠️ A ação nomeia ONDE se baixa o agente (achado 18: aviso que aponta
        // lugar que não resolve).
        expect(t.acao).toMatch(/Baixar Agente A3/);
        expect(t.acao).toMatch(/A1 próprio/);
    });

    it('A1 próprio válido: roda sozinha e NÃO gera aviso', () => {
        const t = trilhoDaNfceSaida({ tipoCert: 'A1', certUploaded: true, certValido: true });
        expect(t.rodaNaNuvem).toBe(true);
        // ⚠️ Aviso em cima de captura que funciona é o jeito conhecido de a
        // equipe parar de ler os avisos que importam.
        expect(avisoDaLinhaNfce(t)).toBeNull();
    });

    // ⚠️ O A1 DA MATRIZ VENCE O A3 (mesma raiz, regra de 27/08 — J.N. VINATEX):
    // ele é testado ANTES, então chegar no ramo do A3 significa que ele não
    // existe. Sem isto, filial coberta pela matriz ganharia aviso à toa.
    it('A1 da matriz (mesma raiz) faz a captura rodar, mesmo com A3 cadastrado', () => {
        const t = trilhoDaNfceSaida({
            tipoCert: 'A3', certUploaded: true, certValido: true, temA1MesmaRaizValido: true,
        });
        expect(t.via).toBe('cloud-a1-raiz');
        expect(avisoDaLinhaNfce(t)).toBeNull();
    });

    it('a empresa do escritório roda pelo cert dela', () => {
        expect(trilhoDaNfceSaida({ ehEscritorio: true }).rodaNaNuvem).toBe(true);
    });

    // ⚠️ Vencido e "sem cert" são causas DIFERENTES, com ações diferentes:
    // renovar × cadastrar. Fundir mandaria renovar o que não existe.
    it('separa certificado vencido de certificado ausente', () => {
        const vencido = trilhoDaNfceSaida({ tipoCert: 'A1', certUploaded: true, certValido: false });
        expect(vencido.acao).toMatch(/Renove/);
        const sem = trilhoDaNfceSaida({});
        expect(sem.acao).toMatch(/Cadastre/);
        // 🚨 E DIZ que o cert do escritório/procuração NÃO serve aqui: o SAE
        // exige que a chave pertença ao CNPJ do certificado. Sem essa frase, a
        // saída óbvia (usar a procuração) parece valer e não vale.
        expect(sem.motivo).toMatch(/procuração e-CAC NÃO servem|escritório e a procuração/);
    });

    it('avisoDaLinhaNfce junta título, motivo e ação', () => {
        const t = trilhoDaNfceSaida({ tipoCert: 'A3', certUploaded: true, certValido: true });
        const frase = avisoDaLinhaNfce(t);
        expect(frase).toContain(t.titulo);
        expect(frase).toContain(t.acao);
    });
});

// ============================================================================
// 🔒 O CERTIFICADO NÃO ATRAVESSA — só o metadado
//
// `empresas_certificados` é fechado ao navegador de propósito: ele guarda
// `storagePath` e `passwordEnc`. A rota existe justamente para levar a
// OPERAÇÃO (a resposta), nunca a chave (a régua do túnel, 07/08).
// ============================================================================
describe('🔒 a rota do trilho não expõe o certificado', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const fonte = readFileSync(join(__dirname, '../sefaz-backend/empresa-status-routes.js'), 'utf8');
    const rota = fonte.slice(fonte.indexOf("router.get('/trilho-saida'"), fonte.indexOf("router.get('/empresas-status-captura'"));

    it('a rota existe e é autenticada', () => {
        expect(rota).toMatch(/requireAuth/);
    });

    it('a resposta não carrega storagePath nem passwordEnc', () => {
        const resposta = rota.slice(rota.indexOf('return res.json('));
        expect(resposta).not.toMatch(/storagePath/);
        expect(resposta).not.toMatch(/passwordEnc/);
    });

    // 📌 Rota nova nasce com o BOTÃO que a chama (regra de 13/08): rota sem
    // caminho na interface é código morto com cara de entrega.
    it('a tela consome a rota', () => {
        const servico = readFileSync(join(__dirname, '../services/xmlFiscalService.ts'), 'utf8');
        expect(servico).toMatch(/sefaz\/trilho-saida/);
        const tela = readFileSync(join(__dirname, '../components/Relatorios/index.tsx'), 'utf8');
        expect(tela).toMatch(/getTrilhoSaida\(empresa\)/);
        expect(tela).toMatch(/trilho\?\.avisoNfce/);
    });
});
