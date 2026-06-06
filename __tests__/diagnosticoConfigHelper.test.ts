/**
 * Testes do diagnóstico de configurações. Env var faltando = feature
 * silenciosamente quebrada. Este teste trava as configs que importam.
 */
// @ts-expect-error — módulo .js puro
import { diagnosticarConfig, CONFIGS_MONITORADAS, MODOS_OPERACIONAIS } from '../sefaz-backend/diagnostico-config-helper.js';

describe('diagnosticarConfig — env totalmente vazia', () => {
    it('todas as configs críticas são reportadas em prod', () => {
        const { resumo, achados } = diagnosticarConfig({}, 'prod');
        // criticos = SERPRO_KEY/SECRET/CNPJ + SEFAZ_CRON_SECRET + STORAGE_BUCKET = 5
        const criticos = achados.filter((a: any) => a.criticidade === 'critico').map((a: any) => a.chave);
        expect(criticos).toContain('SERPRO_CONSUMER_KEY');
        expect(criticos).toContain('SERPRO_CONSUMER_SECRET');
        expect(criticos).toContain('SERPRO_CONTRATANTE_CNPJ');
        expect(criticos).toContain('SEFAZ_CRON_SECRET');
        expect(criticos).toContain('STORAGE_BUCKET');
        expect(resumo.criticos).toBe(5);
    });

    it('todos os altos são reportados (sharepoint + gateway + 5 modos em prod)', () => {
        const { resumo } = diagnosticarConfig({}, 'prod');
        // SHAREPOINT_* (4) + FISCAL_GATEWAY_TOKEN = 5 altos vazios
        // + 5 modos operacionais default já = serpro, então NÃO reportam em prod
        // Mas se env vazia, os modos default kick in com valor 'serpro' = ok em prod
        expect(resumo.altos).toBeGreaterThanOrEqual(5);
    });
});

describe('diagnosticarConfig — env completa', () => {
    const envCompleta = {
        SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's', SERPRO_CONTRATANTE_CNPJ: '44388152000189',
        SEFAZ_CRON_SECRET: 'x', STORAGE_BUCKET: 'b',
        GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's2', SHAREPOINT_HOST: 'h',
        FISCAL_GATEWAY_TOKEN: 'tk',
        CONTADOR_CRC: 'crc', CONTADOR_NOME: 'n', CONTADOR_CPF: 'cpf',
        EMISSAO_BLOQUEADA: 'true',
        DCTFWEB_MODE: 'serpro', DAS_MODE: 'serpro', DARF_MODE: 'serpro',
        NFSE_NAC_MODE: 'serpro', CAIXA_POSTAL_MODE: 'serpro',
    };

    it('zero achados', () => {
        const { resumo, achados } = diagnosticarConfig(envCompleta, 'prod');
        expect(achados).toHaveLength(0);
        expect(resumo.criticos).toBe(0);
        expect(resumo.altos).toBe(0);
    });
});

describe('diagnosticarConfig — modos operacionais', () => {
    it('DCTFWEB_MODE=mock em prod → alerta alto', () => {
        const env = {
            SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's',
            SERPRO_CONTRATANTE_CNPJ: '1', SEFAZ_CRON_SECRET: 'x', STORAGE_BUCKET: 'b',
            GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's2', SHAREPOINT_HOST: 'h',
            FISCAL_GATEWAY_TOKEN: 'tk',
            CONTADOR_CRC: 'crc', CONTADOR_NOME: 'n', CONTADOR_CPF: 'cpf',
            EMISSAO_BLOQUEADA: 'true',
            DCTFWEB_MODE: 'mock',
        };
        const { achados } = diagnosticarConfig(env, 'prod');
        const modo = achados.find((a: any) => a.chave === 'DCTFWEB_MODE');
        expect(modo).toBeTruthy();
        expect(modo.tipo).toBe('modo_inadequado');
        expect(modo.criticidade).toBe('alto');
        expect(modo.valorAtual).toBe('mock');
    });

    it('DCTFWEB_MODE=mock em DEV → ok (não dispara)', () => {
        const env = { DCTFWEB_MODE: 'mock' } as any;
        const { achados } = diagnosticarConfig(env, 'dev');
        const modo = achados.find((a: any) => a.chave === 'DCTFWEB_MODE' && a.tipo === 'modo_inadequado');
        expect(modo).toBeFalsy();
    });
});

describe('diagnosticarConfig — EMISSAO_BLOQUEADA', () => {
    it('vazia em prod → flag indefinida (médio)', () => {
        const env = { ...minimalCompleta(), EMISSAO_BLOQUEADA: '' };
        const { achados } = diagnosticarConfig(env, 'prod');
        const flag = achados.find((a: any) => a.chave === 'EMISSAO_BLOQUEADA');
        expect(flag).toBeTruthy();
        expect(flag.criticidade).toBe('medio');
    });

    it('true ou false → ok (sem reclamar)', () => {
        let env = { ...minimalCompleta(), EMISSAO_BLOQUEADA: 'true' };
        expect(diagnosticarConfig(env, 'prod').achados.find((a: any) => a.chave === 'EMISSAO_BLOQUEADA')).toBeFalsy();
        env = { ...minimalCompleta(), EMISSAO_BLOQUEADA: 'false' };
        expect(diagnosticarConfig(env, 'prod').achados.find((a: any) => a.chave === 'EMISSAO_BLOQUEADA')).toBeFalsy();
    });

    it('valor inválido (1, sim, yes) → reporta', () => {
        const env = { ...minimalCompleta(), EMISSAO_BLOQUEADA: 'sim' };
        const flag = diagnosticarConfig(env, 'prod').achados.find((a: any) => a.chave === 'EMISSAO_BLOQUEADA');
        expect(flag).toBeTruthy();
    });
});

describe('diagnosticarConfig — sanidade', () => {
    it('input null/undefined não quebra', () => {
        expect(() => diagnosticarConfig(null)).not.toThrow();
        expect(() => diagnosticarConfig(undefined)).not.toThrow();
    });

    it('listas de configs e modos exportadas e não-vazias', () => {
        expect(CONFIGS_MONITORADAS.length).toBeGreaterThan(5);
        expect(MODOS_OPERACIONAIS.length).toBeGreaterThan(3);
        // toda config tem chave + criticidade
        CONFIGS_MONITORADAS.forEach((c: any) => {
            expect(c.chave).toBeTruthy();
            expect(['critico', 'alto', 'medio']).toContain(c.criticidade);
        });
    });

    it('valor whitespace ("   ") conta como vazio', () => {
        const env = { ...minimalCompleta(), SERPRO_CONSUMER_KEY: '   ' };
        const { achados } = diagnosticarConfig(env, 'prod');
        expect(achados.find((a: any) => a.chave === 'SERPRO_CONSUMER_KEY')).toBeTruthy();
    });
});

function minimalCompleta(): Record<string, string> {
    return {
        SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's', SERPRO_CONTRATANTE_CNPJ: '1',
        SEFAZ_CRON_SECRET: 'x', STORAGE_BUCKET: 'b',
        GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's2', SHAREPOINT_HOST: 'h',
        FISCAL_GATEWAY_TOKEN: 'tk',
        CONTADOR_CRC: 'crc', CONTADOR_NOME: 'n', CONTADOR_CPF: 'cpf',
        EMISSAO_BLOQUEADA: 'true',
    };
}
