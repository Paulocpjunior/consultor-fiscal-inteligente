/**
 * cepService — autocomplete de endereço por CEP (pedido do Paulo, 01/08).
 *
 * Fonte: ViaCEP (https://viacep.com.br) — pública, sem chave, com CORS. Além
 * do endereço, devolve o `ibge` (código do município, 7 dígitos), que é
 * exatamente o campo que TRAVA trilho no cadastro (decide o caminho da NFS-e
 * e entra no SPED). Um CEP preenche logradouro, bairro, cidade, UF e IBGE de
 * uma vez. Fallback: BrasilAPI (mesmo dado, outra infra).
 */

export interface EnderecoCep {
    cep: string;
    logradouro: string;
    complemento: string;
    bairro: string;
    municipio: string;
    uf: string;
    /** Código IBGE do município (7 dígitos) — o campo que trava trilho. */
    codMunIBGE: string;
}

/** Busca o endereço de um CEP. Devolve null para CEP inexistente. */
export async function buscarCep(cepBruto: string): Promise<EnderecoCep | null> {
    const cep = String(cepBruto || '').replace(/\D/g, '');
    if (cep.length !== 8) return null;

    try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (r.ok) {
            const d = await r.json();
            if (!d.erro && (d.logradouro || d.localidade)) {
                return {
                    cep,
                    logradouro: d.logradouro || '',
                    complemento: d.complemento || '',
                    bairro: d.bairro || '',
                    municipio: d.localidade || '',
                    uf: (d.uf || '').toUpperCase(),
                    codMunIBGE: String(d.ibge || '').replace(/\D/g, ''),
                };
            }
            if (d.erro) return null; // CEP não existe — não tenta fallback
        }
    } catch { /* rede/CORS — tenta o fallback */ }

    try {
        // BrasilAPI v1 não traz o IBGE, mas salva o resto do endereço.
        const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
        if (r.ok) {
            const d = await r.json();
            return {
                cep,
                logradouro: d.street || '',
                complemento: '',
                bairro: d.neighborhood || '',
                municipio: d.city || '',
                uf: (d.state || '').toUpperCase(),
                codMunIBGE: '',
            };
        }
    } catch { /* offline — o formulário segue manual */ }
    return null;
}
