// ============================================================================
// 🚨 UM DIA INTEIRO PERGUNTANDO "QUAL DOS DOIS TEXTOS VOCÊ COPIOU?"
//
// 01-02/09. Os dois apps do Azure recusavam com AADSTS7000215, o painel dizia
// "GRAPH_CLIENT_SECRET configurado" e o app repetia a frase da Microsoft como
// se fosse diagnóstico. O que fechou a questão foi MEDIR o que estava gravado:
// `graph-client-secret` e `graph-notificacoes-secret` tinham os DOIS 36 bytes
// e formato de GUID — o *Secret ID*.
//
// A medição custou um comando; a leitura da mensagem custou o dia. Estes
// testes são essa medição, agora DENTRO do app.
// ============================================================================
import { formaDoClientSecret, segredosDeClientSecret } from '../sefaz-backend/forma-do-segredo.js';
// @ts-expect-error o helper de config não tem .d.ts (o teste dele importa igual)
import { diagnosticarConfig } from '../sefaz-backend/diagnostico-config-helper.js';

// O que estava gravado de verdade nos dois secrets (formato, não o valor):
// GUID de 36 caracteres, que é o *Secret ID* do Azure.
const ID_SECRETO = 'a876887f-a126-424f-8d8a-fc011519855e';
// A forma do *Valor* — ~40 caracteres, com `~`. Inventado aqui de propósito:
// nenhum segredo real entra em teste.
const VALOR_PLAUSIVEL = 'zRu8Q~Kx3vTn2pLm9WdYs6HcJf1AbGe0ZiOrXyQt';

describe('🚨 preenchido é STATUS; a FORMA é resultado', () => {
    it('GUID de 36 caracteres é o Secret ID — e a ação é criar um segredo NOVO', () => {
        const f = formaDoClientSecret(ID_SECRETO);
        expect(f.forma).toBe('id-secreto');
        expect(f.caracteres).toBe(36);
        expect(f.ehProblema).toBe(true);
        expect(f.diagnostico).toMatch(/ID do segredo/);
        // Não há como recuperar o Valor — é isso que a instrução precisa dizer,
        // senão a pessoa volta na mesma tela e copia o mesmo campo de novo.
        expect(f.diagnostico).toMatch(/crie um segredo NOVO/i);
    });

    it('GUID em CAIXA ALTA também é o ID — o Azure copia dos dois jeitos', () => {
        expect(formaDoClientSecret(ID_SECRETO.toUpperCase()).forma).toBe('id-secreto');
    });

    // ⚠️ A colagem de terminal traz `\n` no fim com frequência, e a Microsoft
    // compara caractere a caractere. Sem este caso, um segredo CERTO recusaria
    // e o app diria "é o ID" — dizer a falha errada manda procurar no lugar
    // errado, que é justamente o que custou o dia.
    it('espaço/quebra no fim tem ação PRÓPRIA (regravar sem o espaço)', () => {
        const f = formaDoClientSecret(`${VALOR_PLAUSIVEL}\n`);
        expect(f.forma).toBe('com-espaco-ou-quebra');
        expect(f.ehProblema).toBe(true);
        expect(f.diagnostico).toMatch(/sem o espaço/);
        // ⚠️ E ela NÃO acusa de ser o ID: a ação é outra.
        expect(f.diagnostico).not.toMatch(/segredo NOVO/i);
    });

    it('ID com quebra colada continua sendo o ID — a ação mais específica vence', () => {
        const f = formaDoClientSecret(` ${ID_SECRETO}\n`);
        expect(f.forma).toBe('id-secreto');
        expect(f.diagnostico).toMatch(/espaço ou/);
    });

    it('vazio é dito como vazio, nunca como forma errada', () => {
        for (const v of ['', '   ', null, undefined]) {
            const f = formaDoClientSecret(v);
            expect(f.forma).toBe('vazio');
            expect(f.caracteres).toBe(0);
        }
    });

    // 🚨 A TRAVA QUE FAZ ISTO SERVIR: só acusa o que se PROVA. Cravar "curto
    // demais" ou "caractere estranho" por conta própria acusaria credencial
    // VÁLIDA — e alarme sobre credencial correta é o jeito conhecido de a
    // equipe desligar a trava.
    it('forma que não se reconhece NÃO é acusada — e também não é aprovada', () => {
        const f = formaDoClientSecret(VALOR_PLAUSIVEL);
        expect(f.forma).toBe('nao-reconhecida');
        expect(f.ehProblema).toBe(false);
        expect(f.diagnostico).toBeNull();
        expect(f.caracteres).toBe(VALOR_PLAUSIVEL.length);
    });

    // 🔒 O valor NUNCA sai: a rota do diagnóstico existe justamente porque ela
    // "não expõe VALORES das envs".
    it('nada do conteúdo do segredo sai da régua', () => {
        const serializado = JSON.stringify(formaDoClientSecret(VALOR_PLAUSIVEL));
        expect(serializado).not.toContain(VALOR_PLAUSIVEL);
        expect(serializado).not.toContain(VALOR_PLAUSIVEL.slice(0, 8));
        const doId = JSON.stringify(formaDoClientSecret(ID_SECRETO));
        expect(doId).not.toContain(ID_SECRETO);
    });
});

describe('🔎 a varredura acha a credencial nova sozinha', () => {
    it('casa `*_CLIENT_SECRET`, não uma lista', () => {
        const achadas = segredosDeClientSecret({
            GRAPH_CLIENT_SECRET: 'x',
            SHAREPOINT_CLIENT_SECRET: 'y',
            // ⚠️ Fora de propósito: aqui um GUID não prova nada.
            SERPRO_CONSUMER_SECRET: 'z',
            SEFAZ_CRON_SECRET: 'w',
            GRAPH_CLIENT_ID: 'c',
        });
        expect(achadas).toEqual(['GRAPH_CLIENT_SECRET', 'SHAREPOINT_CLIENT_SECRET']);
    });
});

describe('🚦 o Diagnóstico → Config passou a acusar a forma', () => {
    const ENV_OK = {
        SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's', SERPRO_CONTRATANTE_CNPJ: 'c',
        SEFAZ_CRON_SECRET: 'x', GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'ci',
        SHAREPOINT_HOST: 'h', FISCAL_GATEWAY_TOKEN: 'g',
        CONTADOR_CRC: 'crc', CONTADOR_NOME: 'n', CONTADOR_CPF: 'cpf',
        HEALTH_ALERT_TO: 'a@b.c', STORAGE_BUCKET: 'b', EMISSAO_BLOQUEADA: 'false',
    };

    it('o caso REAL: preenchido, e o que está lá é o Secret ID', () => {
        const { achados, resumo } = diagnosticarConfig(
            { ...ENV_OK, GRAPH_CLIENT_SECRET: ID_SECRETO }, 'prod',
        );
        const a = achados.find((x: any) => x.tipo === 'segredo_forma_errada');
        expect(a).toBeTruthy();
        expect(a.chave).toBe('GRAPH_CLIENT_SECRET');
        expect(a.criticidade).toBe('critico');
        // Causa junto do número: quem lê precisa saber que ESTÁ preenchido.
        expect(a.impacto).toMatch(/36 caracteres/);
        expect(a.impacto).toMatch(/AADSTS7000215/);
        expect(resumo.criticos).toBeGreaterThan(0);
        // 🔒 e o valor não aparece em lugar nenhum da resposta
        expect(JSON.stringify(achados)).not.toContain(ID_SECRETO);
    });

    // ⚠️ NASCE MUDA no caso correto — trava que grita sobre configuração boa
    // é trava desligada.
    it('segredo de forma plausível não gera achado nenhum', () => {
        const { achados } = diagnosticarConfig(
            { ...ENV_OK, GRAPH_CLIENT_SECRET: VALOR_PLAUSIVEL }, 'prod',
        );
        expect(achados.filter((x: any) => x.tipo === 'segredo_forma_errada')).toHaveLength(0);
    });

    // ⚠️ Vazio já tem dono (`env_vazia`) — dois achados para o mesmo defeito é
    // o caminho conhecido para a equipe ignorar os dois.
    it('env vazia continua sendo env_vazia, sem achado duplicado', () => {
        const { achados } = diagnosticarConfig({ ...ENV_OK, GRAPH_CLIENT_SECRET: '' }, 'prod');
        expect(achados.filter((x: any) => x.tipo === 'segredo_forma_errada')).toHaveLength(0);
        expect(achados.some((x: any) => x.tipo === 'env_vazia' && x.chave === 'GRAPH_CLIENT_SECRET')).toBe(true);
    });
});
