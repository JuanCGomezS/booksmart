# Evidencia para sección comercial: reservas y catálogo

**Mercado:** barberías y salones en Colombia  
**Fecha de consulta:** 2026-08-31

## Hallazgos accionables

1. **La reserva puede ser descubrible desde Google.** Google permite añadir enlaces de reserva a un Perfil de Empresa y los muestra a usuarios del perfil en Google Search y Maps. Esto sustenta priorizar una página de reservas con enlace público y una integración/publicación verificable en el perfil; no sustenta una promesa de más reservas.  
   Fuente primaria: [Google Business Profile Help, “Add booking links to your Business Profile”](https://support.google.com/business/answer/6218037?hl=en).

2. **El catálogo puede convertirse en una conversación de WhatsApp.** La API oficial de WhatsApp admite mensajes de un producto y mensajes de varios productos tomados del catálogo; un mensaje de varios productos admite hasta 30 artículos. Esto sustenta que el catálogo tenga nombre, precio, imagen y disponibilidad listos para compartirse; no demuestra ventas ni conversión.  
   Fuente primaria: [Meta for Developers, “Send Products”](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-products).

3. **Los recordatorios son una intervención distinta de la reserva.** Una revisión Cochrane encontró que los recordatorios por SMS aumentan la asistencia frente a no enviar recordatorios, con evidencia procedente de contextos sanitarios. Sirve para justificar probar confirmaciones y recordatorios configurables, pero no para afirmar una reducción porcentual de inasistencias en barberías o salones.  
   Fuente institucional: [Cochrane, _Mobile phone messaging reminders for attendance at healthcare appointments_](https://doi.org/10.1002/14651858.CD007458.pub3).

4. **En Colombia, los mensajes de datos tienen reconocimiento jurídico.** La Ley 527 de 1999 establece que no se negarán efectos jurídicos, validez o fuerza obligatoria a la información por estar en forma de mensaje de datos. Esto respalda conservar confirmaciones y comunicaciones digitales de manera trazable; no convierte por sí solo una reserva en un contrato ni sustituye las obligaciones de protección de datos.  
   Fuente primaria: [Secretaría Jurídica Distrital, Ley 527 de 1999, art. 5](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=4276).

## Afirmaciones seguras para UI

Úsalas únicamente si la función correspondiente está disponible y configurada en BarberFlow/BookSmart:

- “Comparte tu enlace de reservas para que tus clientes encuentren tu agenda en Google.”
- “Muestra tus productos y compártelos por WhatsApp desde tu catálogo.”
- “Envía confirmaciones y recordatorios de cita.”
- “Mantén las confirmaciones de tus citas en un solo lugar.”

## Afirmaciones que **no** son seguras para UI

No usar sin una medición propia, representativa y documentada para Colombia y para este producto:

- “Reduce las inasistencias en X%.”
- “Aumenta tus reservas/ventas/ingresos en X%.”
- “Google o WhatsApp te traerán más clientes.”
- “Las confirmaciones digitales garantizan asistencia, pago o validez contractual.”
- “El catálogo por WhatsApp incrementa la conversión.”

## Nota de alcance

La evidencia de recordatorios proviene de citas de salud, no del sector de belleza; por eso se usa como fundamento para experimentar con la función, no como resultado comercial transferible. Las capacidades de Google y Meta dependen de elegibilidad, configuración y políticas de cada plataforma.
