// Importa matchers do jest-dom (toBeInTheDocument, toHaveTextContent, etc).
// Sem isso, ASSERTS DOM em testes de componente compilam mas falham em runtime
// porque o matcher nao esta registrado no expect global.
import '@testing-library/jest-dom';

export {};
