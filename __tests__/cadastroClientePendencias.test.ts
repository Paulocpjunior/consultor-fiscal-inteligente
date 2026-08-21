/**
 * Pendências do cadastro do cliente — o que falta e o que isso QUEBRA.
 *
 * Paulo, 28/07: "preciso de um modal de cadastro de clientes completo, com o
 * nome do responsável pela empresa — se não tiver, devemos criar — para que
 * fique mais fácil e ágil a correção do cadastro das empresas, bem como
 * delegar para um novo colaborador ou trocar o já existente."
 */
import { conferirCadastroCliente, resumirCadastro } from '../services/cadastroClientePendencias';

const completo = {
    nome: 'CLIENTE LTDA', cnpj: '11222333000181', regime: 'simples',
    uf: 'SP', codMunIBGE: '3550308', inscricaoEstadual: 'ISENTO',
    ccmSp: '12345678', email: 'contato@cliente.com.br', cnae: '4712100',
    anexo: 'I', dataAbertura: '2015-03-01',
    respLegalNome: 'João Sócio', contadorNome: 'Maria Contadora', contadorCrc: '1SP123456/O-8',
    responsaveis: [{ nome: 'Eunice', papel: 'principal' }],
};

const campos = (e: any) => conferirCadastroCliente(e).map((p) => p.campo);

describe('responsável — o motivo do pedido', () => {
    it('cliente sem responsável é BLOQUEIO, com a razão prática', () => {
        const { responsaveis, ...semResp } = completo;
        const p = conferirCadastroCliente(semResp as any);
        expect(p[0]!.campo).toBe('Responsável pela empresa');
        expect(p[0]!.gravidade).toBe('bloqueia');
        expect(p[0]!.impacto).toMatch(/não aparece na carteira/i);
    });

    it('só backup não conta como responsável', () => {
        const p = campos({ ...completo, responsaveis: [{ nome: 'Fulano', papel: 'backup' }] });
        expect(p).toContain('Responsável pela empresa');
    });

    it('vínculo sem nome não conta (registro vazio não é dono)', () => {
        const p = campos({ ...completo, responsaveis: [{ nome: '', papel: 'principal' }] });
        expect(p).toContain('Responsável pela empresa');
    });
});

describe('campos que travam trilho', () => {
    it('UF ausente bloqueia captura e SPED', () => {
        const p = conferirCadastroCliente({ ...completo, uf: '' } as any);
        const uf = p.find((x) => x.campo === 'UF')!;
        expect(uf.gravidade).toBe('bloqueia');
        expect(uf.impacto).toMatch(/SPED/);
    });

    it('sem código do município o app não escolhe o trilho da NFS-e', () => {
        const p = conferirCadastroCliente({ ...completo, codMunIBGE: null } as any);
        expect(p.find((x) => x.campo.includes('IBGE'))!.gravidade).toBe('bloqueia');
    });

    it('Simples sem anexo não calcula DAS', () => {
        expect(campos({ ...completo, anexo: '' })).toContain('Anexo do Simples');
    });

    it('Lucro não é cobrado por anexo (é campo do Simples)', () => {
        expect(campos({ ...completo, regime: 'lucro', anexo: '' })).not.toContain('Anexo do Simples');
    });

    it('bloqueios vêm primeiro na lista', () => {
        const p = conferirCadastroCliente({ ...completo, uf: '', email: '' } as any);
        expect(p[0]!.gravidade).toBe('bloqueia');
        expect(p[p.length - 1]!.gravidade).toBe('atencao');
    });
});

describe('CCM só existe em SP capital', () => {
    it('SP capital sem CCM bloqueia o portal da prefeitura', () => {
        const p = conferirCadastroCliente({ ...completo, ccmSp: '' } as any);
        expect(p.find((x) => x.campo.startsWith('CCM'))!.gravidade).toBe('bloqueia');
    });

    it('empresa de outro município NÃO é cobrada por CCM', () => {
        const p = campos({ ...completo, codMunIBGE: '3526902', ccmSp: '' });
        expect(p.some((c) => c.startsWith('CCM'))).toBe(false);
    });

    it('CCM preenchido fora da capital vira alerta de campo errado', () => {
        const p = conferirCadastroCliente({ ...completo, codMunIBGE: '3526902' } as any);
        const ccm = p.find((x) => x.campo.includes('CCM'))!;
        expect(ccm.gravidade).toBe('atencao');
        expect(ccm.onde).toMatch(/Inscrição Municipal/);
    });

    // 21/08 (Paulo: *"por algum motivo tá constando pendência no CCM"*): o CCM
    // estava certo — o que faltava era o codMunIBGE. Sem o município, afirmar
    // "CCM fora de SP capital" é acusar no escuro um campo preenchido certo;
    // quem acusa a falta é a pendência do próprio código IBGE.
    it('município DESCONHECIDO não acusa o CCM — acusa o código IBGE', () => {
        const p = conferirCadastroCliente({ ...completo, codMunIBGE: '', ccmSp: '29175976' } as any);
        expect(p.some((x) => x.campo.includes('CCM'))).toBe(false);
        expect(p.some((x) => x.campo.includes('Código do município'))).toBe(true);
    });
});

describe('farol do cadastro', () => {
    it('cadastro completo é verde', () => {
        const r = resumirCadastro(conferirCadastroCliente(completo as any));
        expect(r.farol).toBe('ok');
        expect(r.resumo).toBe('Cadastro completo.');
    });

    it('pendência que trava NUNCA é verde nem âmbar', () => {
        const r = resumirCadastro(conferirCadastroCliente({ ...completo, uf: '' } as any));
        expect(r.farol).toBe('bloqueado');
        expect(r.bloqueios).toBe(1);
    });

    it('só ressalvas = âmbar, dizendo que nada trava', () => {
        const r = resumirCadastro(conferirCadastroCliente({ ...completo, email: '' } as any));
        expect(r.farol).toBe('atencao');
        expect(r.resumo).toMatch(/nada travando/);
    });

    it('o selo diz O QUE revisar — número sozinho gerou a dúvida da equipe (31/07)', () => {
        const r = resumirCadastro(conferirCadastroCliente({ ...completo, email: '' } as any));
        expect(r.motivo).toBe('E-mail do cliente');
        expect(r.campos).toEqual(['E-mail do cliente']);
        expect(r.resumo).toMatch(/E-mail do cliente/);
    });

    it('com mais de uma pendência, o selo mostra a dominante e conta o resto', () => {
        const r = resumirCadastro(conferirCadastroCliente({ ...completo, uf: '', email: '', cnae: '' } as any));
        expect(r.motivo).toBe('UF');           // bloqueio vem primeiro
        expect(r.resumo).toMatch(/UF \(e mais 2\)/);
    });

    it('cadastro completo não inventa motivo', () => {
        const r = resumirCadastro(conferirCadastroCliente(completo as any));
        expect(r.motivo).toBeNull();
        expect(r.campos).toEqual([]);
    });

    it('responsável legal e contador são obrigatórios pros relatórios (01/08)', () => {
        expect(campos({ ...completo, respLegalNome: '' })).toContain('Responsável legal da empresa');
        expect(campos({ ...completo, contadorNome: '' })).toContain('Contador responsável');
        // Contador com nome mas sem CRC também pende — a identificação exige os dois.
        expect(campos({ ...completo, contadorCrc: '' })).toContain('CRC do contador');
        expect(campos(completo)).toEqual([]);
    });

    it('toda pendência traz impacto e onde resolver', () => {
        const p = conferirCadastroCliente({ regime: 'simples' } as any);
        expect(p.length).toBeGreaterThan(3);
        for (const x of p) {
            expect(x.impacto.length).toBeGreaterThan(10);
            expect(x.onde.length).toBeGreaterThan(3);
        }
    });
});
