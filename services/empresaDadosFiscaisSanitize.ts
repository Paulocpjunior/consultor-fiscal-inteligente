/**
 * empresaDadosFiscaisSanitize.ts — PURO (testável).
 *
 * Regra que já quebrou duas vezes: campo LIMPO tem de chegar ao backend como
 * string vazia (''), que é a ordem de APAGAR. Se virar `undefined`, o
 * JSON.stringify some com a chave, o backend não recebe nada e o valor velho
 * fica preso — foi o "CCM não aceita ficar sem valor" (26/07, DARCY) e de novo
 * o "colaborador não consegue gravar" (27/07, FASTWELD/Guarulhos).
 *
 * Campo NUNCA tocado continua ausente do objeto (undefined) — esse é o jeito
 * de dizer "não mexe neste campo".
 */
import type { EmpresaDadosFiscais } from '../types';
import { normalizarCodCliente } from '../sefaz-backend/cod-cliente.js';

/** Só dígitos; '' quando não sobrar nada. */
function digitos(v: string): string {
    return v.replace(/\D/g, '');
}

/**
 * A régua do CCM SÓ-ZEROS, num lugar só (#311): '', '0', '00000000'… NÃO é
 * inscrição — é o contorno que a equipe digitava num campo que parecia
 * obrigatório, e vale como VAZIO em TODO leitor. Em 21/08 (Paulo: *"coloco uma
 * sequência de 8 zeros… e o erro segue"*) a regra existia na gravação e na
 * captura de NFS-e, mas a régua de PENDÊNCIAS não a conhecia — e acusava
 * "CCM preenchido fora de SP capital" sobre zeros que significam "não tem".
 * Devolve null para vazio/só-zeros; senão o valor original (sem reformatar).
 */
export function soZerosComoVazio(v: unknown): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return /^0*$/.test(digitos(s)) && !/[1-9]/.test(s) ? null : s;
}

export function sanitizarDadosFiscais(dados: EmpresaDadosFiscais): EmpresaDadosFiscais {
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const trim = (v: unknown): string | undefined => {
        const s = str(v);
        return s == null ? undefined : s.trim();
    };
    const numerico = (v: unknown): string | undefined => {
        const s = str(v);
        return s == null ? undefined : digitos(s);
    };

    const ccmBruto = str(dados.ccmSp);
    // Cod.Cliente: aplica a régua do E-Fiscal (zero à esquerda, 0001–9999) já
    // aqui — "1" digitado vira "0001" na tela antes de viajar. Valor inválido
    // segue como está: o backend recusa com a mensagem certa (não silenciar).
    const codClienteBruto = str(dados.codCliente);
    const codClienteNorm = codClienteBruto == null ? undefined
        : (() => { const r = normalizarCodCliente(codClienteBruto); return r.ok ? r.valor : codClienteBruto.trim(); })();
    return {
        ...dados,
        codCliente: codClienteNorm,
        inscricaoEstadual: trim(dados.inscricaoEstadual)?.toUpperCase(),
        uf: trim(dados.uf)?.toUpperCase(),
        codMunIBGE: numerico(dados.codMunIBGE),
        cep: numerico(dados.cep),
        telefone: numerico(dados.telefone),
        // CCM canônico: só dígitos. Zeros (000000000) são o contorno que a
        // equipe digitava num campo que parecia obrigatório → tratados como
        // vazio (apaga), igual ao backend.
        ccmSp: ccmBruto == null ? undefined : (/^0*$/.test(digitos(ccmBruto)) ? '' : digitos(ccmBruto)),
        // Inscrição municipal genérica: NÃO stripa (pode ser alfanumérica
        // conforme a prefeitura); só trim.
        inscricaoMunicipal: trim(dados.inscricaoMunicipal),
        // CNAE aceita o formato com máscara (4712-1/00) — só trim; apagar e
        // salvar remove ('' = ordem de apagar, mesma regra dos demais).
        cnae: trim(dados.cnae),
        dataAbertura: trim(dados.dataAbertura),
        // Responsável legal e contador (identificação dos relatórios): nomes e
        // cargo só trim; CPFs canônicos em dígitos; CRC fica LIVRE (formato
        // varia por regional — 1SP123456/O-8, CRC-SP 123456…), só trim.
        respLegalNome: trim(dados.respLegalNome),
        respLegalCpf: numerico(dados.respLegalCpf),
        respLegalCargo: trim(dados.respLegalCargo),
        contadorNome: trim(dados.contadorNome),
        contadorCrc: trim(dados.contadorCrc),
        contadorCpf: numerico(dados.contadorCpf),
        contadorId: trim(dados.contadorId),
        // MÚLTIPLOS responsáveis (03/08): linhas totalmente vazias caem fora; o
        // PRIMEIRO da lista espelha nos campos legados respLegal* — conferência
        // e PDFs antigos continuam lendo de lá. Lista tocada e vazia = ordem de
        // apagar (legado vira '' também).
        ...(dados.responsaveisLegais == null ? {} : (() => {
            const lista = (dados.responsaveisLegais || [])
                .map((r) => ({
                    nome: (r?.nome || '').trim(),
                    cpf: digitos(r?.cpf || ''),
                    cargo: (r?.cargo || '').trim(),
                }))
                .filter((r) => r.nome || r.cpf || r.cargo);
            const primeiro = lista[0];
            return {
                responsaveisLegais: lista,
                respLegalNome: primeiro?.nome ?? '',
                respLegalCpf: primeiro?.cpf ?? '',
                respLegalCargo: primeiro?.cargo ?? '',
            };
        })()),
        // Condição rural: booleano vai EXPLÍCITO (true/false), nunca undefined
        // — desmarcar precisa chegar ao backend como false, mesma lição do CCM.
        // Bloco intocado continua ausente (undefined) e nada muda.
        condicaoRural: dados.condicaoRural == null ? undefined : {
            adquireDeProdutor: !!dados.condicaoRural.adquireDeProdutor,
            ehProdutorRuralPF: !!dados.condicaoRural.ehProdutorRuralPF,
            ehCooperativa: !!dados.condicaoRural.ehCooperativa,
            funruralSubRogacao: dados.condicaoRural.funruralSubRogacao === 'nao_aplica' ? 'nao_aplica' : 'automatico',
            observacao: (dados.condicaoRural.observacao || '').trim(),
        },
    };
}
