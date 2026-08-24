# Plantilla: recuperación de contraseña

Configúrala en **Firebase Console → Authentication → Templates → Password reset**.

- **Sender name:** `BookSmart`
- **Subject:** `Restablece tu contraseña de BookSmart`

## Cuerpo del correo

> Conserva `%LINK%` exactamente como está: Firebase lo reemplaza por el enlace seguro y de un solo uso.

```text
Hola,

Recibimos una solicitud para restablecer la contraseña de tu cuenta en BookSmart.

Para crear una nueva contraseña, usa el siguiente enlace seguro:

%LINK%

Por tu seguridad, no compartas este enlace con nadie. Si no solicitaste este cambio, puedes ignorar este correo: tu contraseña actual seguirá siendo válida.

Gracias,
Equipo BookSmart
```

## Antes de publicarlo

1. En **Authentication → Sign-in method**, confirma que **Email/Password** está habilitado.
2. En **Authentication → Settings → Authorized domains**, agrega el dominio de producción de BookSmart si aún no aparece.
3. Envía una recuperación desde `/login` y verifica la llegada del correo y el enlace.

La aplicación muestra un mensaje genérico después de solicitar el correo para no revelar si una dirección tiene una cuenta registrada.
