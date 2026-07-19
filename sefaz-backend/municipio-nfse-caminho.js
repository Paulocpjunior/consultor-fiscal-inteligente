// ============================================================================
// sefaz-backend/municipio-nfse-caminho.js  (ESM)
//
// Recomendação do CAMINHO de captura de NFS-e por município (referência 2026).
//
// Contexto (LC 214/2025): o Padrão Nacional NFS-e (ADN — Ambiente de Dados
// Nacional, distribuição DF-e) passou a ser OBRIGATÓRIO para todos os municípios
// a partir de 01/01/2026. Cada prefeitura adota o Emissor Nacional OU mantém o
// próprio compartilhando 100% com o ADN — nos dois casos a nota chega ao ADN.
// A ABRASF congelou o modelo SOAP; vários municípios já descontinuaram o layout
// ABRASF em 2026 (Guarulhos e Ribeirão Preto em 01/07/2026, São José dos Campos
// em dez/2025).
//
// Consequência para o app: o caminho de captura correto em 2026 é o NACIONAL
// (nfse-nacional-dfe), que é POR CNPJ e independe de município. Por isso o
// DEFAULT recomendado aqui é 'adn'. ABRASF (config-municipios.js) fica como
// LEGADO, só para notas anteriores à migração. SP capital tem portal próprio.
// ============================================================================

export const CAMINHO_NFSE = {
    ADN: 'adn',             // Padrão Nacional / distribuição DF-e (por CNPJ, nacional)
    SP_PORTAL: 'sp-portal', // SP capital — portal CSV + WS próprio
    ABRASF: 'abrasf',       // legado SOAP municipal (em descontinuação em 2026)
};

// Municípios com particularidade CONHECIDA. Todo município fora desta lista usa
// ADN por padrão (regra 2026). Os 7 abaixo foram confirmados no Padrão Nacional.
export const MUNICIPIOS_NFSE = {
    '3550308': { nome: 'São Paulo',              uf: 'SP', caminho: CAMINHO_NFSE.SP_PORTAL, obs: 'Portal CSV + WS próprio; ADN em transição.' },

    // Os 7 municípios priorizados — todos no Padrão Nacional (ADN) em 2026.
    '3518800': { nome: 'Guarulhos',              uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'ABRASF descontinuado em 01/07/2026; Simples pelo Emissor Nacional a partir de ~ago/2026.' },
    '3534401': { nome: 'Osasco',                 uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'Sistema próprio transcreve para o ADN desde jan/2026.' },
    '3547809': { nome: 'Santo André',            uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'GISSOnline; compartilha com o ADN.' },
    '3548708': { nome: 'São Bernardo do Campo',  uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'Emissão pelo Portal Nacional desde jan/2026.' },
    '3552205': { nome: 'Sorocaba',               uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'Emissor próprio apto a compartilhar com o ADN.' },
    '3549904': { nome: 'São José dos Campos',    uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'Sistema local desligado em dez/2025 → Emissor Nacional.' },
    '3543402': { nome: 'Ribeirão Preto',         uf: 'SP', caminho: CAMINHO_NFSE.ADN, obs: 'Layout ABRASF descontinuado em 01/07/2026 (DPS/RTC nacional).' },
};

/**
 * Caminho de captura recomendado para um município (código IBGE 7 dígitos).
 * Município não catalogado → ADN (padrão nacional de 2026). Função PURA.
 * @returns {{ cod: string|null, nome: string|null, uf: string|null, caminho: string, conhecido: boolean, obs: string }}
 */
export function caminhoNfseRecomendado(codMunIBGE) {
    const cod = String(codMunIBGE || '').replace(/\D/g, '');
    if (cod.length !== 7) {
        return {
            cod: cod || null, nome: null, uf: null,
            caminho: CAMINHO_NFSE.ADN, conhecido: false,
            obs: 'Código IBGE ausente/inválido — em 2026 o padrão é o ADN nacional (LC 214/2025), captura por CNPJ.',
        };
    }
    const m = MUNICIPIOS_NFSE[cod];
    if (m) return { cod, ...m, conhecido: true };
    return {
        cod, nome: null, uf: null,
        caminho: CAMINHO_NFSE.ADN, conhecido: false,
        obs: 'Município no Padrão Nacional (ADN) — captura por CNPJ, sem config específica.',
    };
}

/** Lista os municípios catalogados (para o guia na tela). */
export function listarMunicipiosNfse() {
    return Object.entries(MUNICIPIOS_NFSE).map(([cod, m]) => ({ cod, ...m }));
}
