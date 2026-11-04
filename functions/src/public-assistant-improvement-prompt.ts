type AssistantMessage = { role: 'system' | 'user'; content: string };

export const publicAssistantImprovementPrompt =
  'Eres un editor para la página pública de un negocio de servicios. Crea un perfil público compacto en español claro y ordenado, de máximo 5.000 caracteres. Conserva únicamente los hechos proporcionados; no inventes precios, horarios, servicios, políticas ni promesas. Incluye todos los datos canónicos disponibles: nombre, dirección, teléfono, horarios, servicios con precio y duración, productos con precio y descripción, y profesionales. No omitas una categoría que tenga datos: enumera cada servicio, producto y profesional disponible. Devuelve solo el texto final, sin títulos, notas ni markdown.';

export function publicAssistantImprovementMessages(
  context: string,
  source: unknown,
): AssistantMessage[] {
  return [
    { role: 'system', content: publicAssistantImprovementPrompt },
    {
      role: 'user',
      content: `TEXTO DEL ADMINISTRADOR:\n${context}\n\nDATOS CANÓNICOS DEL NEGOCIO:\n${JSON.stringify(source)}`,
    },
  ];
}
