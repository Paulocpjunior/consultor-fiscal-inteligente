// ============================================================================
// 🚨 O CAMPO PEDIA "CAMINHO" E A PESSOA COLA O LINK — que é o gesto natural
//
// 02/09. Colado o link que o próprio SharePoint dá em "Copiar link", o app
// respondeu com a mensagem crua do Graph:
//
//   Failed to list folder (400): {"error":{"code":"BadRequest","message":
//   "Resource not found for the segment 'root:'"...
//
// O proxy monta `/drive/root:/{caminho}:/children`, e uma URL inteira ali
// produz uma rota que não existe. E o link não é "o jeito errado": ele é
// MELHOR, porque carrega o site junto — enquanto o caminho digitado depende
// de o proxy apontar para o site certo, que era justamente o problema (o
// proxy resolve /sites/ClientesSP2 e o link é de /sites/GRUPOFISCAL).
// ============================================================================
// @ts-expect-error proxy-backend é JS sem tipos gerados
import { ehLinkDeCompartilhamento, idDeCompartilhamento, recorteDoCaminho } from '../proxy-backend/sharepoint-caminho.js';

// O link REAL do print (mesma forma que o SharePoint gera).
const LINK = 'https://spassessoriacontabilcombr.sharepoint.com/:f:/s/GRUPOFISCAL/'
    + 'IgCItHQ3YYBVS4MrKYSfqn4fAfRIZE5J88M98idzSHee-Cg?e=zfvg8K';

describe('🔗 link e caminho são coisas diferentes', () => {
    it('reconhece o link real do print', () => {
        expect(ehLinkDeCompartilhamento(LINK)).toBe(true);
        expect(recorteDoCaminho(LINK).tipo).toBe('link');
    });

    it('caminho de pasta NÃO é confundido com link', () => {
        const p = 'Empresas/Grupo Flanacar/DEPARTAMENTO FISCAL/2026/09-2026/CMM/XML SAÍDA';
        expect(ehLinkDeCompartilhamento(p)).toBe(false);
        expect(recorteDoCaminho(p)).toEqual({ tipo: 'caminho', valor: p, shareId: null });
    });

    // ⚠️ Barra sobrando produzia um segmento VAZIO na rota do Graph — outro
    // 400 com cara de "a pasta não existe", mandando conferir o nome da pasta.
    it('barra no começo e no fim não muda a pasta', () => {
        expect(recorteDoCaminho('/Empresas/X/').valor).toBe('Empresas/X');
    });

    it('vazio é dito como vazio', () => {
        expect(recorteDoCaminho('   ').tipo).toBe('vazio');
    });
});

describe('🔗 o id que o Graph espera em /shares/{id}/driveItem', () => {
    // Formato documentado: `u!` + base64 da URL, com +→-, /→_ e sem o `=`.
    it('u! + base64url, sem preenchimento', () => {
        const id = idDeCompartilhamento(LINK);
        expect(id.startsWith('u!')).toBe(true);
        expect(id).not.toMatch(/[+/=]/);
        // e volta a ser a MESMA url quando decodificado — é isso que o Graph faz
        const b64 = id.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(LINK);
    });

    it('caminho comum não vira share id', () => {
        expect(idDeCompartilhamento('Empresas/X')).toBeNull();
    });
});

// ============================================================================
// 🚨 O SITE ESTAVA CRAVADO — e é ele que decide ONDE a pasta é procurada
//
// `SITE_PATH = '/sites/ClientesSP2'` vivia no código do proxy. O link que a
// equipe usa é de `/sites/GRUPOFISCAL`: mesmo com o caminho certo, a pasta
// seria procurada no site errado, e o Graph responde "não existe" — que manda
// conferir o nome da pasta. É a família do tenant cravado (28/08).
// ============================================================================
describe('🚦 o site do proxy sai de env, com o valor de hoje como padrão', () => {
    it('o código não crava mais o site nem o host', () => {
        const fonte = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'proxy-backend', 'sharepoint-sync.js'), 'utf8',
        );
        expect(fonte).toMatch(/process\.env\.SHAREPOINT_SITE_PATH/);
        expect(fonte).toMatch(/process\.env\.SHAREPOINT_HOST/);
        // ⚠️ E o erro passou a dizer ONDE procurou: sem isso, "pasta não
        // existe" manda conferir a pasta quando o problema pode ser o site.
        expect(fonte).toMatch(/em \$\{ondeProcurou\}/);
    });
});
