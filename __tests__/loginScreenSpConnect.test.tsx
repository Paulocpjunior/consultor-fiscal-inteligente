// ============================================================================
// 🚨 A TELA DE LOGIN DO /connect NÃO PODE DIZER "Consultor Fiscal Inteligente"
// ----------------------------------------------------------------------------
// Paulo, ao testar o app pelo Teams: "ontem falamos sobre o nome, não dá p
// ficar usando consultor fiscal" — mesma regra já registrada pro resto do
// SP Connect (17/08: "eu não queria que os colaboradores associassem a
// você" — a identidade é da CASA, nunca da ferramenta). O LoginScreen é
// compartilhado (mesmo Firebase Auth), mas a TELA precisa dizer qual app é.
// ============================================================================
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../services/authService', () => ({
    login: jest.fn(),
    register: jest.fn(),
}));
jest.mock('../services/firebaseConfig', () => ({ isFirebaseConfigured: true }));

import LoginScreen from '../components/LoginScreen';

describe('LoginScreen — identidade por app', () => {
    it('sem spConnect, segue dizendo Consultor Fiscal Inteligente (o CFI)', () => {
        render(<LoginScreen onLoginSuccess={() => { /* noop */ }} />);
        expect(screen.getByText('Consultor Fiscal Inteligente')).toBeTruthy();
    });

    it('com spConnect, diz SP Connect — nunca o nome do CFI', () => {
        render(<LoginScreen onLoginSuccess={() => { /* noop */ }} spConnect />);
        expect(screen.getByText('SP Connect')).toBeTruthy();
        expect(screen.queryByText('Consultor Fiscal Inteligente')).toBeNull();
    });
});
