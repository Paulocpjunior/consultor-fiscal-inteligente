// ============================================================================
// 🚨 LISTA DE NOMES NÃO É RESPOSTA — qual desses apps é o NOSSO?
//
// 26/08, ao cortar a plataforma antiga. O painel mostrou os apps assinados na
// WABA — `Business Agent · API_Oficial · f-bot` — e o Paulo precisava decidir
// QUAL remover. Três nomes sem dono não decidem nada, e o custo do erro não é
// simétrico: **remover o nosso desliga o recebimento de mensagem do escritório
// inteiro**, calado, e ninguém liga o alarme porque a tela disse "removido".
//
// 🚨 E O NOME NÃO SERVE DE PISTA: o nome do app na Meta não é escolhido por
// nós — "API_Oficial" pode ser de qualquer um. Deduzir pelo nome seria a
// família do `1405`: identificador inventado que parece plausível.
//
// Quem responde é a Meta: `debug_token` diz de QUAL APP o token é. Fonte, não
// dedução.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = process.cwd();
const cloud = readFileSync(join(raiz, 'sefaz-backend/whatsapp-cloud.js'), 'utf8');
const dts = readFileSync(join(raiz, 'sefaz-backend/whatsapp-cloud.d.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'components/ConfigAdminModal.tsx'), 'utf8');

describe('🚨 quem diz qual app é o nosso é a META', () => {
    it('pergunta pelo `debug_token`, não pelo nome', () => {
        expect(cloud).toMatch(/debug_token\?input_token=/);
        const fn = cloud.slice(cloud.indexOf('export async function descobrirAppDoToken'));
        expect(fn.slice(0, 900)).toMatch(/app_id/);
    });

    it('a listagem marca cada app com `nosso`', () => {
        const fn = cloud.slice(cloud.indexOf('export async function listarAppsAssinadosNaWaba'));
        expect(fn.slice(0, 1600)).toMatch(/nosso: meu\.ok \? a\.id === meu\.appId : null/);
    });

    it('🚨 falhar em perguntar devolve `null`, NUNCA `false`', () => {
        // "não sei" e "não é nosso" mandam fazer coisas opostas: uma manda
        // parar, a outra libera remover. Um `false` por omissão aqui é o app
        // afirmando o que não mediu — no clique que desliga o atendimento.
        const fn = cloud.slice(cloud.indexOf('export async function listarAppsAssinadosNaWaba'));
        expect(fn.slice(0, 1600)).toMatch(/meu\.ok \? meu\.appId : null/);
        expect(fn.slice(0, 1600)).not.toMatch(/nosso: false/);
    });

    it('e a falha NÃO derruba a lista — ela continua útil sem a marca', () => {
        const fn = cloud.slice(cloud.indexOf('export async function listarAppsAssinadosNaWaba'));
        expect(fn.slice(0, 1600)).toMatch(/\.catch\(\(\) => \(\{ ok: false \}\)\)/);
    });
});

describe('☑️ e a tela mostra a marca — com a ressalva quando não há', () => {
    it('marca o nosso e nomeia o de terceiro', () => {
        expect(tela).toMatch(/este é o nosso/);
        expect(tela).toMatch(/de terceiro/);
    });

    it('🚨 sem resposta da Meta, a tela DIZ que não sabe', () => {
        // Ausência de marca lida como "nenhum é nosso" seria pior que não ter
        // marca nenhuma — e a ação seguinte é irreversível.
        expect(tela).toMatch(/significa "não sei", não "não é nosso"/);
        expect(tela).toMatch(/a\.nosso === null/);
    });
});

describe('📌 o `.d.ts` anda no MESMO PR (regra de 20/08)', () => {
    it('declara o campo novo e a função nova', () => {
        expect(dts).toMatch(/nossoAppId\?: string \| null/);
        expect(dts).toMatch(/nosso\?: boolean \| null/);
        expect(dts).toMatch(/export function descobrirAppDoToken/);
    });
});
