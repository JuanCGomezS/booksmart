import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publicAssistantImprovementMessages,
  publicAssistantImprovementPrompt,
} from '../src/public-assistant-improvement-prompt.js';

test('requires canonical business information in an improved public profile', () => {
  assert.match(publicAssistantImprovementPrompt, /Incluye todos los datos canónicos disponibles/);
  assert.match(publicAssistantImprovementPrompt, /servicios con precio y duración/);
  assert.match(publicAssistantImprovementPrompt, /productos con precio y descripción/);
  assert.match(publicAssistantImprovementPrompt, /profesionales/);
  assert.match(publicAssistantImprovementPrompt, /No omitas una categoría que tenga datos/);
});

test('sends all canonical business categories to the improvement model', () => {
  const context = 'Aceptamos efectivo.';
  const source = {
    name: 'Clínica dental',
    address: 'Cra 112 #12-24',
    phone: '300 000 0000',
    workingHours: { '1': { open: '09:00', close: '18:00', enabled: true } },
    services: [{ name: 'Limpieza', price: 80000, duration: 45 }],
    products: [{ name: 'Cepillo dental', description: 'Cerdas suaves', price: 15000 }],
    staff: [{ name: 'Dra. Pérez' }],
  };
  const messages = publicAssistantImprovementMessages(context, source);

  assert.deepEqual(messages[0], { role: 'system', content: publicAssistantImprovementPrompt });
  assert.deepEqual(messages[1], {
    role: 'user',
    content: `TEXTO DEL ADMINISTRADOR:\n${context}\n\nDATOS CANÓNICOS DEL NEGOCIO:\n${JSON.stringify(source)}`,
  });
});
